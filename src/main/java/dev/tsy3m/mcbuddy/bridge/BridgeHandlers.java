package dev.tsy3m.mcbuddy.bridge;

import com.google.gson.JsonObject;
import dev.tsy3m.mcbuddy.BuddyAgent;
import dev.tsy3m.mcbuddy.BuddyConfig;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

public final class BridgeHandlers {
   private static final int MAX_CHUNK_RADIUS = 6;
   private static final int MAX_ENTRIES = 40;

   public static String handle(JsonObject request) {
      Integer id = BridgeJson.idOf(request);
      String method = request.has("method") && request.get("method").isJsonPrimitive() ? request.get("method").getAsString() : "";
      MinecraftServer server = Minecraft.getInstance().getSingleplayerServer();
      if (server == null) {
         return BridgeJson.error(id, "no world loaded");
      } else {
         switch (method) {
            case "ping": {
               JsonObject result = new JsonObject();
               result.addProperty("pong", true);
               result.addProperty("tick", server.getTickCount());
               return BridgeJson.result(id, result);
            }
            case "status": {
               JsonObject result = new JsonObject();
               result.addProperty("tick", server.getTickCount());
               result.add("agent", BuddyAgent.statusJson());
               result.add("others", BuddyAgent.otherPlayersJson());
               JsonObject pause = new JsonObject();
               pause.addProperty("client_paused", Minecraft.getInstance().isPaused());
               pause.addProperty("server_paused", server.isPaused());
               pause.addProperty("keep_ticking_while_paused", BuddyConfig.keepTickingWhilePaused);
               pause.addProperty("dev_writes", BuddyConfig.devWrites);
               result.add("pause", pause);
               result.addProperty("event_cursor", EventQueue.latest());
               return BridgeJson.result(id, result);
            }
            case "camera.shot": {
               if (net.fabricmc.loader.api.FabricLoader.getInstance().getEnvironmentType() != net.fabricmc.api.EnvType.CLIENT) {
                  return BridgeJson.error(id, "camera is client-only");
               }

               try {
                  return BridgeJson.result(id, dev.tsy3m.mcbuddy.ClientCamera.capture(BridgeJson.intParam(request, "downscale", 2)));
               } catch (Exception e) {
                  return BridgeJson.error(id, "camera: " + e.getMessage());
               }
            }
            case "world.map": {
               ServerPlayer mapSelf = BuddyAgent.current();
               return BridgeJson.result(
                  id,
                  WorldMap.of(
                     server.overworld(),
                     BridgeJson.intParam(request, "x", mapSelf == null ? 0 : mapSelf.blockPosition().getX()),
                     BridgeJson.intParam(request, "z", mapSelf == null ? 0 : mapSelf.blockPosition().getZ()),
                     BridgeJson.intParam(request, "radius", BridgeJson.intParam(request, "radius", 40))
                  )
               );
            }
            case "camera.on": {
               if (net.fabricmc.loader.api.FabricLoader.getInstance().getEnvironmentType() != net.fabricmc.api.EnvType.CLIENT) {
                  return BridgeJson.error(id, "camera is client-only");
               }

               dev.tsy3m.mcbuddy.FreeCam.activate(
                  BridgeJson.doubleParam(request, "x", 0.0),
                  BridgeJson.doubleParam(request, "y", 80.0),
                  BridgeJson.doubleParam(request, "z", 0.0),
                  (float)BridgeJson.doubleParam(request, "yaw", 0.0),
                  (float)BridgeJson.doubleParam(request, "pitch", 0.0)
               );
               JsonObject camOut = new JsonObject();
               camOut.addProperty("freecam", true);
               return BridgeJson.result(id, camOut);
            }
            case "camera.set": {
               dev.tsy3m.mcbuddy.FreeCam.set(
                  BridgeJson.doubleParam(request, "x", 0.0),
                  BridgeJson.doubleParam(request, "y", 80.0),
                  BridgeJson.doubleParam(request, "z", 0.0),
                  (float)BridgeJson.doubleParam(request, "yaw", 0.0),
                  (float)BridgeJson.doubleParam(request, "pitch", 0.0)
               );
               JsonObject camSet = new JsonObject();
               camSet.addProperty("moved", true);
               return BridgeJson.result(id, camSet);
            }
            case "camera.off": {
               dev.tsy3m.mcbuddy.FreeCam.deactivate();
               JsonObject camOff = new JsonObject();
               camOff.addProperty("freecam", false);
               return BridgeJson.result(id, camOff);
            }
            case "world.digest": {
               ServerPlayer digestSelf = BuddyAgent.current();
               int x = BridgeJson.intParam(request, "x", digestSelf == null ? 0 : digestSelf.blockPosition().getX());
               int z = BridgeJson.intParam(request, "z", digestSelf == null ? 0 : digestSelf.blockPosition().getZ());
               int radius = Math.max(1, Math.min(6, BridgeJson.intParam(request, "chunk_radius", 2)));
               return BridgeJson.result(id, WorldDigest.of(server, x, z, radius, 40));
            }
            case "world.column": {
               ServerPlayer self = BuddyAgent.current();
               int feet = self == null ? 64 : self.blockPosition().getY();
               int x = BridgeJson.intParam(request, "x", self == null ? 0 : self.blockPosition().getX());
               int z = BridgeJson.intParam(request, "z", self == null ? 0 : self.blockPosition().getZ());
               return BridgeJson.result(
                  id, WorldDigest.column(server, x, z, BridgeJson.intParam(request, "y0", feet - 2), BridgeJson.intParam(request, "y1", feet + 4))
               );
            }
            case "world.find": {
               ServerPlayer self = BuddyAgent.current();
               int feet = self == null ? 64 : self.blockPosition().getY();
               return BridgeJson.result(
                  id,
                  WorldDigest.find(
                     server,
                     BridgeJson.stringParam(request, "block", "stone"),
                     BridgeJson.intParam(request, "x", self == null ? 0 : self.blockPosition().getX()),
                     BridgeJson.intParam(request, "z", self == null ? 0 : self.blockPosition().getZ()),
                     BridgeJson.intParam(request, "y0", feet - 8),
                     BridgeJson.intParam(request, "y1", feet + 8),
                     BridgeJson.intParam(request, "radius", 12)
                  )
               );
            }
            case "events.poll":
               long cursor = BridgeJson.longParam(request, "cursor", 0L);
               return BridgeJson.result(id, EventQueue.poll(cursor));
            case "agent.walk_to": {
               double x = BridgeJson.doubleParam(request, "x", 0.0);
               double y = BridgeJson.doubleParam(request, "y", 64.0);
               double z = BridgeJson.doubleParam(request, "z", 0.0);
               return BridgeJson.result(id, BuddyAgent.walkTo(x, y, z, !BridgeJson.hasParam(request, "y")));
            }
            case "world.pad":
               return BridgeJson.result(id, WorldFixture.pad(server, BridgeJson.intParam(request, "radius", 5)));
            case "agent.teleport":
               return BridgeJson.result(
                  id,
                  BuddyAgent.teleportTo(
                     BridgeJson.doubleParam(request, "x", 0.0), BridgeJson.doubleParam(request, "y", 0.0), BridgeJson.doubleParam(request, "z", 0.0)
                  )
               );
            case "agent.claim": {
               ServerPlayer self = BuddyAgent.current();
               double cx = self == null ? 0.0 : self.getX();
               double cy = self == null ? 0.0 : self.getY();
               double cz = self == null ? 0.0 : self.getZ();
               return BridgeJson.result(
                  id,
                  BuddyAgent.claimMove(
                     BridgeJson.doubleParam(request, "x", cx),
                     BridgeJson.doubleParam(request, "y", cy),
                     BridgeJson.doubleParam(request, "z", cz),
                     BridgeJson.boolParam(request, "on_ground", self != null && self.onGround())
                  )
               );
            }
            case "agent.stand_for": {
               ServerPlayer self = BuddyAgent.current();
               BlockPos at = BlockPos.containing(
                  BridgeJson.doubleParam(request, "x", self == null ? 0.0 : self.getX()),
                  BridgeJson.doubleParam(request, "y", self == null ? 0.0 : self.getY()),
                  BridgeJson.doubleParam(request, "z", self == null ? 0.0 : self.getZ())
               );
               return BridgeJson.result(id, BuddyAgent.standFor(at, BridgeJson.intParam(request, "radius", 8)));
            }
            case "agent.break": {
               ServerPlayer self = BuddyAgent.current();
               BlockPos at = BlockPos.containing(
                  BridgeJson.doubleParam(request, "x", self == null ? 0.0 : self.getX()),
                  BridgeJson.doubleParam(request, "y", self == null ? 0.0 : self.getY()),
                  BridgeJson.doubleParam(request, "z", self == null ? 0.0 : self.getZ())
               );
               return BridgeJson.result(id, BuddyAgent.breakAt(at, BridgeJson.stringParam(request, "bp", null)));
            }
            case "agent.place": {
               ServerPlayer self = BuddyAgent.current();
               BlockPos fallback = self == null ? BlockPos.ZERO : self.blockPosition().relative(self.getDirection());
               BlockPos at = BlockPos.containing(
                  BridgeJson.doubleParam(request, "x", fallback.getX()),
                  BridgeJson.doubleParam(request, "y", fallback.getY()),
                  BridgeJson.doubleParam(request, "z", fallback.getZ())
               );
               return BridgeJson.result(id, BuddyAgent.placeAt(at, BridgeJson.stringParam(request, "bp", null)));
            }
            case "world.edits":
               return BridgeJson.result(
                  id,
                  EditLog.query(
                     BridgeJson.longParam(request, "since", 0L), BridgeJson.stringParam(request, "bp", null), BridgeJson.intParam(request, "limit", 0)
                  )
               );
            case "agent.say":
               return BridgeJson.result(id, BuddyAgent.say(server, BridgeJson.stringParam(request, "text", "")));
            case "agent.pick": {
               ServerPlayer self = BuddyAgent.current();
               BlockPos target = self == null
                  ? BlockPos.ZERO
                  : BlockPos.containing(
                     BridgeJson.doubleParam(request, "x", self.getX()),
                     BridgeJson.doubleParam(request, "y", self.getY()),
                     BridgeJson.doubleParam(request, "z", self.getZ())
                  );
               return BridgeJson.result(id, BuddyAgent.pickBlock(target));
            }
            case "agent.relocate":
               return BridgeJson.result(id, BuddyAgent.relocate(BridgeJson.intParam(request, "radius", 8)));
            case "agent.gamemode":
               return BridgeJson.result(id, BuddyAgent.setGameMode(BridgeJson.stringParam(request, "mode", "survival")));
            case "task.status":
               return BridgeJson.result(id, BuddyAgent.taskStatus());
            default:
               return BridgeJson.error(id, "unknown method: " + method);
         }
      }
   }
}
