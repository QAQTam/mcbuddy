package dev.tsy3m.mcbuddy.bridge;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.tsy3m.mcbuddy.BuddyConfig;
import dev.tsy3m.mcbuddy.Mcbuddy;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.ConcurrentLinkedQueue;

public final class BridgeServer {
   private static final ConcurrentLinkedQueue<BridgeServer.Pending> QUEUE = new ConcurrentLinkedQueue<>();
   private static final int MAX_PER_TICK = 4;
   private static volatile boolean running;
   private static ServerSocket listener;

   public static void start() {
      if (BuddyConfig.bridgeEnabled && !running) {
         running = true;
         Thread thread = new Thread(BridgeServer::acceptLoop, "mcbuddy-bridge");
         thread.setDaemon(true);
         thread.start();
         Mcbuddy.LOGGER.info("[mcbuddy] bridge listening on 127.0.0.1:{}", BuddyConfig.bridgePort);
      }
   }

   public static void stop() {
      running = false;

      try {
         if (listener != null) {
            listener.close();
         }
      } catch (IOException var1) {
      }
   }

   private static void acceptLoop() {
      try {
         listener = new ServerSocket(BuddyConfig.bridgePort, 4, InetAddress.getLoopbackAddress());

         while (running) {
            Socket socket = listener.accept();
            Thread worker = new Thread(() -> serve(socket), "mcbuddy-bridge-conn");
            worker.setDaemon(true);
            worker.start();
         }
      } catch (IOException var21) {
         if (running) {
            Mcbuddy.LOGGER.warn("[mcbuddy] bridge stopped early", var21);
         }
      }
   }

   private static void serve(Socket socket) {
      try (
         BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
         BufferedWriter out = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8));
      ) {
         boolean rejectionLogged = false;

         String line;
         while (running && (line = in.readLine()) != null) {
            if (!line.isBlank()) {
               JsonObject request = BridgeJson.parse(line);
               if (request == null) {
                  write(out, BridgeJson.error(null, "request is not a JSON object"));
               } else if (!authorized(request)) {
                  if (!rejectionLogged) {
                     rejectionLogged = true;
                     Mcbuddy.LOGGER
                        .warn("[mcbuddy] bridge refused a request from {} - set bridge_token / MCBUDDY_TOKEN to match", socket.getRemoteSocketAddress());
                  }

                  write(out, BridgeJson.error(BridgeJson.idOf(request), "unauthorized: bridge_token required"));
               } else {
                  String response = await(out, request);
                  write(out, response);
               }
            }
         }
      } catch (RuntimeException | IOException var23) {
      } finally {
         try {
            socket.close();
         } catch (IOException var18) {
         }
      }
   }

   private static boolean authorized(JsonObject request) {
      String required = BuddyConfig.bridgeToken;
      if (!required.isEmpty() && !"ping".equals(BridgeJson.methodOf(request))) {
         JsonElement supplied = request.has("token") ? request.get("token") : null;
         return supplied != null && supplied.isJsonPrimitive()
            ? MessageDigest.isEqual(required.getBytes(StandardCharsets.UTF_8), supplied.getAsString().getBytes(StandardCharsets.UTF_8))
            : false;
      } else {
         return true;
      }
   }

   private static String await(BufferedWriter writer, JsonObject request) {
      Integer id = BridgeJson.idOf(request);
      BridgeServer.Pending pending = new BridgeServer.Pending(writer, request);
      QUEUE.add(pending);
      synchronized (pending) {
         long deadline = System.currentTimeMillis() + 5000L;

         while (pending.response == null && System.currentTimeMillis() < deadline) {
            try {
               pending.wait(200L);
            } catch (InterruptedException var9) {
               Thread.currentThread().interrupt();
               break;
            }
         }
      }

      return pending.response != null ? pending.response : BridgeJson.error(id, "game did not answer within 5s");
   }

   public static void tick() {
      for (int i = 0; i < 4; i++) {
         BridgeServer.Pending pending = QUEUE.poll();
         if (pending == null) {
            return;
         }

         String response;
         try {
            response = BridgeHandlers.handle(pending.request);
         } catch (Throwable t) {
            Mcbuddy.LOGGER.error("[mcbuddy] bridge handler failed for {}", pending.request, t);
            response = BridgeJson.error(BridgeJson.idOf(pending.request), "handler crashed: " + t.getMessage());
         }

         synchronized (pending) {
            pending.response = response;
            pending.notifyAll();
         }
      }
   }

   private static void write(BufferedWriter writer, String line) throws IOException {
      synchronized (writer) {
         writer.write(line);
         writer.newLine();
         writer.flush();
      }
   }

   private static final class Pending {
      final BufferedWriter writer;
      final JsonObject request;
      String response;

      Pending(BufferedWriter writer, JsonObject request) {
         this.writer = writer;
         this.request = request;
      }
   }
}
