package dev.tsy3m.mcbuddy;

import com.google.gson.JsonObject;
import com.mojang.blaze3d.pipeline.RenderTarget;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;

/** Client-only: grab the game window framebuffer as PNG for the bridge. */
public final class ClientCamera {
   private ClientCamera() {
   }

   public static JsonObject capture(int downscale) throws Exception {
      CompletableFuture<JsonObject> future = new CompletableFuture<>();
      Minecraft.getInstance().execute(() -> {
         try {
            RenderTarget target = Minecraft.getInstance().gameRenderer.mainRenderTarget();
            Path tmp = Files.createTempFile("mcbuddy-shot-", ".png");
            // the pixel readback completes on a later frame — do ALL file work
            // inside the callback, then hand the result back
            Screenshot.takeScreenshot(target, Math.max(1, downscale), img -> {
               try {
                  img.writeToFile(tmp.toFile());
                  byte[] bytes = Files.readAllBytes(tmp);
                  Files.deleteIfExists(tmp);
                  JsonObject out = new JsonObject();
                  out.addProperty("format", "png");
                  out.addProperty("bytes", bytes.length);
                  out.addProperty("data_base64", Base64.getEncoder().encodeToString(bytes));
                  future.complete(out);
               } catch (Throwable t) {
                  future.completeExceptionally(t);
               }
            });
         } catch (Throwable t) {
            future.completeExceptionally(t);
         }
      });
      return future.get(4L, TimeUnit.SECONDS);
   }
}
