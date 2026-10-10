package dev.tsy3m.mcbuddy;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mojang.authlib.GameProfile;
import dev.tsy3m.mcbuddy.bridge.EditLog;
import dev.tsy3m.mcbuddy.mixin.ServerCommonPacketListenerImplAccessor;
import dev.tsy3m.mcbuddy.mixin.ServerGamePacketListenerImplTeleportAccessor;
import dev.tsy3m.mcbuddy.nav.WalkTask;
import io.netty.channel.ChannelHandler;
import io.netty.channel.embedded.EmbeddedChannel;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.Connection;
import net.minecraft.network.chat.ChatType;
import net.minecraft.network.chat.PlayerChatMessage;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.network.protocol.common.ServerboundKeepAlivePacket;
import net.minecraft.network.protocol.game.ServerboundAcceptTeleportationPacket;
import net.minecraft.network.protocol.game.ServerboundClientTickEndPacket;
import net.minecraft.network.protocol.game.ServerboundPickItemFromBlockPacket;
import net.minecraft.network.protocol.game.ServerboundPlayerActionPacket;
import net.minecraft.network.protocol.game.ServerboundUseItemOnPacket;
import net.minecraft.network.protocol.game.ServerboundMovePlayerPacket.PosRot;
import net.minecraft.network.protocol.game.ServerboundPlayerActionPacket.Action;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.tags.BlockTags;
import net.minecraft.util.TickThrottler;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import org.jspecify.annotations.Nullable;

public final class BuddyAgent {
   private static final int DRAIN_BUDGET = 8192;
   private static final int MAX_RISE = 2;
   private static final int MAX_DROP = 16;
   private static final int[] HEIGHT_TRIES = new int[]{0, -1, 1, -2, 2, -3, 3};
   private static final int SAY_COST_TICKS = 20;
   private static final int CHAT_SPAM_WINDOW_SECONDS = 10;
   @Nullable
   private static ServerPlayer agent;
   @Nullable
   private static Connection connection;
   @Nullable
   private static EmbeddedChannel channel;
   private static boolean queueShapeReported;
   private static boolean pendingSpawn;
   private static boolean spawning;
   private static long lastDrivenTick = -1L;
   private static int interactionSequence = 0;
   private static final TickThrottler sayRate = new TickThrottler(20, 200);

   public static void onPlayerPlaced(ServerPlayer joined) {
      if (BuddyConfig.spawnOnLoad && agent == null && !spawning && joined != agent) {
         pendingSpawn = true;
      }
   }

   public static void tickPendingSpawn(ServerPlayer self) {
      if (pendingSpawn && self != agent) {
         pendingSpawn = false;
         Mcbuddy.LOGGER.info("[mcbuddy] auto-spawning after '{}' joined", self.nameAndId().name());
         spawn(self.level().getServer(), BuddyConfig.agentName);
      }
   }

   public static String spawn(MinecraftServer server, String name) {
      if (agent != null) {
         return "already spawned as " + displayName();
      } else {
         ServerLevel level = server.getLevel(Level.OVERWORLD);
         if (level == null) {
            return "no overworld loaded";
         } else {
            List<ServerPlayer> players = server.getPlayerList().getPlayers();
            GameProfile profile = new GameProfile(UUID.randomUUID(), name);
            CommonListenerCookie cookie = CommonListenerCookie.createInitial(profile, false);
            ServerPlayer created = new ServerPlayer(server, level, profile, cookie.clientInformation());
            if (!players.isEmpty()) {
               ServerPlayer human = players.get(0);
               Vec3 spot = standableSpotNear(level, human.position(), 4);
               if (spot == null) {
                  return "no standable block near the human player";
               }

               created.setPos(spot.x, spot.y, spot.z);
               created.setYRot(human.getYRot());
               created.setXRot(human.getXRot());
            }

            Connection createdConnection = new Connection(PacketFlow.SERVERBOUND);
            EmbeddedChannel createdChannel = new EmbeddedChannel(new ChannelHandler[]{createdConnection});
            spawning = true;

            try {
               server.getPlayerList().placeNewPlayer(createdConnection, created, cookie);
            } finally {
               spawning = false;
            }

            created.gameMode.changeGameModeForPlayer(GameType.CREATIVE);
            connection = createdConnection;
            channel = createdChannel;
            agent = created;
            Mcbuddy.LOGGER
               .info(
                  "[mcbuddy] agent spawned name={} uuid={} entityId={} at {}", new Object[]{name, created.getUUID(), created.getId(), created.blockPosition()}
               );
            return "spawned " + name + " (creative)";
         }
      }
   }

   @Nullable
   private static Vec3 standableSpotNear(ServerLevel level, Vec3 anchor, int maxRadius) {
      BlockPos anchorPos = BlockPos.containing(anchor);

      for (int radius = 1; radius <= maxRadius; radius++) {
         for (int dx = -radius; dx <= radius; dx++) {
            for (int dz = -radius; dz <= radius; dz++) {
               if (Math.max(Math.abs(dx), Math.abs(dz)) == radius) {
                  for (int y = anchorPos.getY() + 2; y >= anchorPos.getY() - 16; y--) {
                     BlockPos feet = anchorPos.offset(dx, y - anchorPos.getY(), dz);
                     if (standable(level, feet)) {
                        return new Vec3(feet.getX() + 0.5, feet.getY(), feet.getZ() + 0.5);
                     }
                  }
               }
            }
         }
      }

      return null;
   }

   private static boolean standable(ServerLevel level, BlockPos feet) {
      if (!roomFor(level, feet)) {
         return false;
      } else {
         int exits = 0;

         for (BlockPos side : new BlockPos[]{feet.east(), feet.west(), feet.north(), feet.south()}) {
            if (clearAt(level, side)) {
               exits++;
            }
         }

         return exits >= 2;
      }
   }

   private static boolean roomFor(ServerLevel level, BlockPos feet) {
      return clearAt(level, feet) && ground(level.getBlockState(feet.below()));
   }

   private static boolean ground(BlockState below) {
      return !below.isAir() && !below.is(BlockTags.LEAVES) && !below.liquid();
   }

   private static boolean clearAt(ServerLevel level, BlockPos pos) {
      return level.getBlockState(pos).isAir() && level.getBlockState(pos.above()).isAir();
   }

   public static String remove(MinecraftServer server) {
      ServerPlayer gone = agent;
      if (gone == null) {
         return "no agent spawned";
      } else {
         EmbeddedChannel oldChannel = channel;
         agent = null;
         connection = null;
         channel = null;
         server.getPlayerList().remove(gone);
         if (oldChannel != null) {
            oldChannel.close();
         }

         Mcbuddy.LOGGER.info("[mcbuddy] agent removed");
         return "removed";
      }
   }

   public static String teleportToPlayer(MinecraftServer server) {
      ServerPlayer self = agent;
      if (self == null) {
         return "no agent spawned";
      } else {
         for (ServerPlayer other : server.getPlayerList().getPlayers()) {
            if (other != self) {
               self.teleportTo(other.getX(), other.getY(), other.getZ());
               return "teleported to " + other.getName().getString();
            }
         }

         return "no other player in the world";
      }
   }

   public static String comeToPlayer(MinecraftServer server) {
      ServerPlayer self = agent;
      if (self == null) {
         return "no agent spawned (: !buddy spawn first)";
      } else {
         for (ServerPlayer other : server.getPlayerList().getPlayers()) {
            if (other != self) {
               JsonObject r = walkTo(other.getX(), other.getY(), other.getZ(), true);
               if (r.has("accepted") && r.get("accepted").getAsBoolean()) {
                  return "coming to " + other.getName().getString() + " (" + Math.round(self.position().distanceTo(other.position())) + " blocks)";
               }

               return "cannot reach " + other.getName().getString() + ": " + (r.has("reason") ? r.get("reason").getAsString() : "refused");
            }
         }

         return "no other player in the world";
      }
   }

   public static String sayFromCommand(MinecraftServer server, String text) {
      if (text != null && !text.isBlank()) {
         JsonObject r = say(server, text);
         return r.has("said") && r.get("said").getAsBoolean() ? "said it" : "say refused: " + (r.has("reason") ? r.get("reason").getAsString() : "unknown");
      } else {
         return "usage: !buddy say <text>";
      }
   }

   public static JsonObject relocate(int radius) {
      JsonObject out = new JsonObject();
      ServerPlayer self = agent;
      if (self == null) {
         out.addProperty("moved", false);
         out.addProperty("reason", "no agent spawned");
         return out;
      } else {
         Vec3 from = self.position();
         Vec3 spot = standableSpotNear(self.level(), from, radius);
         out.addProperty("from", describe(from));
         if (spot == null) {
            out.addProperty("moved", false);
            out.addProperty("reason", "no standable spot with an exit within " + radius + " blocks");
            return out;
         } else {
            self.teleportTo(spot.x, spot.y, spot.z);
            out.addProperty("moved", true);
            out.addProperty("to", describe(spot));
            Mcbuddy.LOGGER.info("[mcbuddy] agent relocated {} -> {}", describe(from), describe(spot));
            return out;
         }
      }
   }

   public static JsonObject setGameMode(String wanted) {
      JsonObject out = new JsonObject();
      ServerPlayer self = agent;
      if (self == null) {
         out.addProperty("changed", false);
         out.addProperty("reason", "no agent spawned");
         return out;
      } else if (!BuddyConfig.devWrites) {
         out.addProperty("changed", false);
         out.addProperty("reason", "dev_writes is off - this is a rig operation, not something the agent does");
         return out;
      } else {
         GameType mode = null;

         for (GameType candidate : GameType.values()) {
            if (candidate.getSerializedName().equalsIgnoreCase(wanted.trim())) {
               mode = candidate;
               break;
            }
         }

         if (mode == null) {
            out.addProperty("changed", false);
            out.addProperty("reason", "unknown gamemode: " + wanted);
            out.addProperty("known", String.join(",", Arrays.stream(GameType.values()).map(GameType::getSerializedName).toList()));
            return out;
         } else {
            String before = self.gameMode().getName();
            boolean changed = self.gameMode.changeGameModeForPlayer(mode);
            out.addProperty("changed", changed);
            out.addProperty("before", before);
            out.addProperty("after", self.gameMode().getName());
            out.addProperty("health", self.getHealth());
            out.addProperty("mayfly", self.getAbilities().mayfly);
            out.addProperty("invulnerable", self.getAbilities().invulnerable);
            Mcbuddy.LOGGER
               .info(
                  "[mcbuddy] rig gamemode {} -> {} health={} mayfly={} invulnerable={}",
                  new Object[]{before, self.gameMode().getName(), self.getHealth(), self.getAbilities().mayfly, self.getAbilities().invulnerable}
               );
            return out;
         }
      }
   }

   public static JsonObject claimMove(double x, double y, double z, boolean onGround) {
      JsonObject out = new JsonObject();
      ServerPlayer self = agent;
      if (self == null) {
         out.addProperty("accepted", false);
         out.addProperty("reason", "no agent spawned");
         return out;
      } else if (!BuddyConfig.devWrites) {
         out.addProperty("accepted", false);
         out.addProperty("reason", "dev_writes is off - this is a rig operation, not something the agent does");
         return out;
      } else if (WalkTask.current() != null) {
         out.addProperty("accepted", false);
         out.addProperty("reason", "a walk task is running - it owns this tick's position packet");
         return out;
      } else {
         Vec3 from = self.position();
         Vec3 claimed = new Vec3(x, y, z);
         float yaw = self.getYRot();
         out.addProperty("mode", self.gameMode().getName());
         out.addProperty("from", describe(from));
         out.addProperty("claimed", describe(claimed));
         out.addProperty("health_before", self.getHealth());
         out.addProperty("on_ground_before", self.onGround());
         sendInbound(new PosRot(x, y, z, yaw, self.getXRot(), onGround, self.horizontalCollision));
         sendInbound(ServerboundClientTickEndPacket.INSTANCE);
         Vec3 achieved = self.position();
         boolean accepted = achieved.distanceToSqr(claimed) < 1.0E-6;
         out.addProperty("accepted", accepted);
         out.addProperty("dx", round3(achieved.x - from.x));
         out.addProperty("dy", round3(achieved.y - from.y));
         out.addProperty("dz", round3(achieved.z - from.z));
         out.addProperty("claimed_delta", describe(self.getDeltaMovement()));
         out.addProperty("residual", round3(achieved.distanceTo(claimed)));
         out.addProperty("setback_latched", teleportLatched(self));
         out.addProperty("health_after", self.getHealth());
         out.addProperty("fall_distance", round3(self.fallDistance));
         out.addProperty("on_ground_after", self.onGround());
         Mcbuddy.LOGGER
            .info(
               "[mcbuddy] rig claim {} in {}: accepted={} residual={} hp={} -> {} fd={} latched={}",
               new Object[]{
                  describe(claimed),
                  self.gameMode().getName(),
                  accepted,
                  round3(achieved.distanceTo(claimed)),
                  self.getHealth(),
                  describe(achieved),
                  round3(self.fallDistance),
                  teleportLatched(self)
               }
            );
         return out;
      }
   }

   private static double round3(double value) {
      return Math.round(value * 1000.0) / 1000.0;
   }

   private static String describe(Vec3 pos) {
      return Math.round(pos.x * 10.0) / 10.0 + "," + Math.round(pos.y * 10.0) / 10.0 + "," + Math.round(pos.z * 10.0) / 10.0;
   }

   public static String status() {
      ServerPlayer self = agent;
      return self == null
         ? "no agent spawned"
         : displayName()
            + " at "
            + self.blockPosition()
            + " in "
            + self.level().dimension().identifier()
            + " health="
            + self.getHealth()
            + " gamemode="
            + self.gameMode();
   }

   public static boolean spawned() {
      return agent != null;
   }

   @Nullable
   public static ServerPlayer current() {
      return agent;
   }

   public static void tickIfAgent(ServerPlayer self) {
      if (self == agent) {
         ConnectionProbe.onAgentTick(self);
         EmbeddedChannel ownChannel = channel;
         if (self == agent && ownChannel != null) {
            int dropped = 0;
            String headType = null;

            Object outbound;
            for (int budget = 8192; budget-- > 0 && (outbound = ownChannel.readOutbound()) != null; dropped++) {
               if (headType == null) {
                  headType = outbound.getClass().getName();
               }
            }

            if (dropped > 0 && !queueShapeReported) {
               queueShapeReported = true;
               Mcbuddy.LOGGER.info("[mcbuddy] outbound queue held {} message(s); head type = {} (teleport ack pending M2)", dropped, headType);
            }
         }
      }
   }

   public static void tickAgentConnection() {
      ServerPlayer self = agent;
      if (self != null && !self.isRemoved()) {
         long tick = self.level().getServer().getTickCount();
         if (tick != lastDrivenTick) {
            lastDrivenTick = tick;
            sayRate.tick();
            answerKeepAlive(self);
            self.connection.tick();
            ackPendingTeleport(self);
            WalkTask.tick(self);
         }
      }
   }

   private static void ackPendingTeleport(ServerPlayer self) {
      if (self.connection instanceof ServerGamePacketListenerImplTeleportAccessor accessor) {
         Vec3 awaited = accessor.mcbuddy$awaitingPositionFromClient();
         if (awaited != null) {
            EmbeddedChannel own = channel;
            if (own != null) {
               Mcbuddy.LOGGER.info("[mcbuddy] acking teleport {} at {}", accessor.mcbuddy$awaitingTeleport(), awaited);
               own.writeInbound(
                  new Object[]{
                     new ServerboundAcceptTeleportationPacket(
                        accessor.mcbuddy$awaitingTeleport(), awaited.x, awaited.y, awaited.z, self.getYRot(), self.getXRot()
                     )
                  }
               );
            }
         }
      }
   }

   public static JsonObject walkTo(double x, double y, double z, boolean snapToSurface) {
      JsonObject out = new JsonObject();
      ServerPlayer self = agent;
      if (self == null) {
         out.addProperty("accepted", false);
         out.addProperty("reason", "no agent spawned");
         return out;
      } else {
         return WalkTask.start(self.level(), self.position(), new Vec3(x, y, z), snapToSurface);
      }
   }

   public static JsonObject taskStatus() {
      JsonObject out = new JsonObject();
      WalkTask task = WalkTask.current();
      out.addProperty("running", task != null);
      return out;
   }

   private static void answerKeepAlive(ServerPlayer self) {
      if (self.connection instanceof ServerCommonPacketListenerImplAccessor accessor) {
         if (accessor.mcbuddy$keepAlivePending()) {
            EmbeddedChannel own = channel;
            if (own != null) {
               own.writeInbound(new Object[]{new ServerboundKeepAlivePacket(accessor.mcbuddy$keepAliveChallenge())});
            }
         }
      }
   }

   public static JsonObject pickBlock(BlockPos pos) {
      JsonObject out = new JsonObject();
      ServerPlayer self = agent;
      if (self == null) {
         out.addProperty("held", "");
         out.addProperty("reason", "no agent spawned");
         return out;
      } else {
         String before = describe(self.getInventory().getSelectedItem());
         ItemStack clone = self.level().getBlockState(pos).getCloneItemStack(self.level(), pos, true);
         out.addProperty("target_block", bare(id(clone)));
         out.addProperty("within_reach", self.isWithinBlockInteractionRange(pos, 1.0));
         sendInbound(new ServerboundPickItemFromBlockPacket(pos, true));
         String held = describe(self.getInventory().getSelectedItem());
         out.addProperty("held", held);
         out.addProperty("slot", self.getInventory().getSelectedSlot());
         out.addProperty("changed", !held.equals(before));
         Mcbuddy.LOGGER.info("[mcbuddy] pick {} -> held '{}' slot {}", new Object[]{pos, held, self.getInventory().getSelectedSlot()});
         return out;
      }
   }

   private static String id(ItemStack stack) {
      return BuiltInRegistries.ITEM.getKey(stack.getItem()).toString();
   }

   private static String blockId(BlockState state) {
      return bare(BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());
   }

   public static JsonObject placeAt(BlockPos target) {
      return placeAt(target, null);
   }

   public static JsonObject placeAt(BlockPos target, String bp) {
      JsonObject out = new JsonObject();
      ServerPlayer self = agent;
      if (self == null) {
         out.addProperty("placed", false);
         out.addProperty("reason", "no agent spawned");
         return out;
      } else {
         ServerLevel level = self.level();
         ItemStack held = self.getInventory().getSelectedItem();
         out.addProperty("held", describe(held));
         out.addProperty("teleport_latched", teleportLatched(self));
         if (held.isEmpty()) {
            out.addProperty("placed", false);
            out.addProperty("reason", "empty hand - agent.pick first");
            return out;
         } else {
            BlockPos support = null;
            Direction face = null;

            for (Direction towards : Direction.values()) {
               BlockPos candidate = target.relative(towards);
               if (!level.getBlockState(candidate).isAir()) {
                  support = candidate;
                  face = towards.getOpposite();
                  break;
               }
            }

            if (support == null) {
               out.addProperty("placed", false);
               out.addProperty("reason", "no solid neighbour to click from");
               return out;
            } else {
               Vec3 hit = Vec3.atCenterOf(support).add(Vec3.atCenterOf(target)).scale(0.5);
               out.addProperty("support", blockId(level.getBlockState(support)));
               out.addProperty("within_reach", self.isWithinBlockInteractionRange(support, 1.0));
               String before = blockId(level.getBlockState(target));
               sendInbound(new ServerboundUseItemOnPacket(InteractionHand.MAIN_HAND, new BlockHitResult(hit, face, support, false), nextSequence()));
               String after = blockId(level.getBlockState(target));
               out.addProperty("target_before", before);
               out.addProperty("target_after", after);
               out.addProperty("placed", !after.equals(before));
               if (!after.equals(before)) {
                  EditLog.record("place", target.getX(), target.getY(), target.getZ(), before, after, bp, level.getServer().getTickCount());
               }

               Mcbuddy.LOGGER
                  .info(
                     "[mcbuddy] place into {} by clicking {} face {}: {} -> {} (latched={})",
                     new Object[]{target, support, face, before, after, teleportLatched(self)}
                  );
               return out;
            }
         }
      }
   }

   public static JsonObject breakAt(BlockPos pos) {
      return breakAt(pos, null);
   }

   public static JsonObject breakAt(BlockPos pos, String bp) {
      JsonObject out = new JsonObject();
      ServerPlayer self = agent;
      if (self == null) {
         out.addProperty("broken", false);
         out.addProperty("reason", "no agent spawned");
         return out;
      } else {
         ServerLevel level = self.level();
         String before = blockId(level.getBlockState(pos));
         out.addProperty("before", before);
         out.addProperty("within_reach", self.isWithinBlockInteractionRange(pos, 1.0));
         out.addProperty("teleport_latched", teleportLatched(self));
         sendInbound(new ServerboundPlayerActionPacket(Action.START_DESTROY_BLOCK, pos, Direction.UP, nextSequence()));
         sendInbound(new ServerboundPlayerActionPacket(Action.STOP_DESTROY_BLOCK, pos, Direction.UP, nextSequence()));
         String after = blockId(level.getBlockState(pos));
         out.addProperty("after", after);
         out.addProperty("broken", "air".equals(after) && !after.equals(before));
         if (!after.equals(before)) {
            EditLog.record("break", pos.getX(), pos.getY(), pos.getZ(), before, after, bp, level.getServer().getTickCount());
         }

         Mcbuddy.LOGGER.info("[mcbuddy] break {} -> {} (latched={})", new Object[]{pos, after, teleportLatched(self)});
         return out;
      }
   }

   public static JsonObject standFor(BlockPos target, int maxRadius) {
      JsonObject out = new JsonObject();
      ServerPlayer self = agent;
      if (self == null) {
         out.addProperty("reachable", false);
         out.addProperty("reason", "no agent spawned");
         return out;
      } else {
         ServerLevel level = self.level();
         double eyeAboveFeet = self.getEyePosition().y - self.getY();
         double maxRange = self.blockInteractionRange() + 1.0;
         AABB box = new AABB(target);
         out.addProperty("range_blocks", maxRange);

         for (int radius = 1; radius <= maxRadius; radius++) {
            for (int dx = -radius; dx <= radius; dx++) {
               for (int dz = -radius; dz <= radius; dz++) {
                  if (Math.max(Math.abs(dx), Math.abs(dz)) == radius) {
                     for (int dy : HEIGHT_TRIES) {
                        BlockPos candidate = target.offset(dx, dy, dz);
                        if (standable(level, candidate)) {
                           Vec3 eye = new Vec3(candidate.getX() + 0.5, candidate.getY() + eyeAboveFeet, candidate.getZ() + 0.5);
                           if (box.distanceToSqr(eye) < maxRange * maxRange) {
                              out.addProperty("reachable", true);
                              out.addProperty("stand", describe(new Vec3(candidate.getX() + 0.5, candidate.getY(), candidate.getZ() + 0.5)));
                              out.addProperty("from_target_blocks", Math.max(Math.abs(dx), Math.abs(dz)));
                              return out;
                           }
                        }
                     }
                  }
               }
            }
         }

         out.addProperty("reachable", false);
         out.addProperty("reason", "no standable cell within " + maxRadius + " of the target is in range");
         return out;
      }
   }

   public static JsonObject teleportTo(double x, double y, double z) {
      JsonObject out = new JsonObject();
      ServerPlayer self = agent;
      if (self == null) {
         out.addProperty("moved", false);
         out.addProperty("reason", "no agent spawned");
         return out;
      } else if (!BuddyConfig.devWrites) {
         out.addProperty("moved", false);
         out.addProperty("reason", "dev_writes is off - this is a rig operation, not something the agent does");
         return out;
      } else {
         ServerLevel level = self.level();
         BlockPos wanted = BlockPos.containing(x, y, z);
         Vec3 spot;
         if (standable(level, wanted)) {
            spot = new Vec3(wanted.getX() + 0.5, wanted.getY(), wanted.getZ() + 0.5);
         } else {
            spot = standableSpotNear(level, new Vec3(wanted.getX() + 0.5, wanted.getY(), wanted.getZ() + 0.5), 3);
         }

         out.addProperty("from", describe(self.position()));
         if (spot == null) {
            out.addProperty("moved", false);
            out.addProperty("reason", "no standable cell at or within 3 of the requested spot");
            return out;
         } else {
            self.teleportTo(spot.x, spot.y, spot.z);
            out.addProperty("moved", true);
            out.addProperty("to", describe(spot));
            out.addProperty("adjusted", !describe(spot).equals(describe(new Vec3(wanted.getX() + 0.5, wanted.getY(), wanted.getZ() + 0.5))));
            Mcbuddy.LOGGER.info("[mcbuddy] rig teleport {} -> {}", out.get("from"), describe(spot));
            return out;
         }
      }
   }

   private static boolean teleportLatched(ServerPlayer self) {
      return self.connection instanceof ServerGamePacketListenerImplTeleportAccessor accessor && accessor.mcbuddy$awaitingPositionFromClient() != null;
   }

   private static int nextSequence() {
      interactionSequence++;
      return interactionSequence;
   }

   private static String describe(ItemStack stack) {
      return stack.isEmpty() ? "" : bare(id(stack)) + " x" + stack.getCount();
   }

   private static String bare(String descriptionId) {
      int colon = descriptionId.indexOf(58);
      return colon >= 0 ? descriptionId.substring(colon + 1) : descriptionId;
   }

   public static JsonObject say(MinecraftServer server, String text) {
      JsonObject out = new JsonObject();
      ServerPlayer self = agent;
      if (self == null) {
         out.addProperty("said", false);
         out.addProperty("reason", "no agent spawned");
         return out;
      } else {
         String trimmed = text.length() > 256 ? text.substring(0, 256) : text;
         if (!sayRate.isUnderThreshold()) {
            out.addProperty("said", false);
            out.addProperty("reason", "rate_limited");
            out.addProperty("retry_after_ticks", 20);
            return out;
         } else {
            sayRate.increment();
            server.getPlayerList().broadcastChatMessage(PlayerChatMessage.unsigned(self.getUUID(), trimmed), self, ChatType.bind(ChatType.CHAT, self));
            out.addProperty("said", true);
            out.addProperty("text", trimmed);
            Mcbuddy.LOGGER.info("[mcbuddy] agent says: {}", trimmed);
            return out;
         }
      }
   }

   public static JsonArray otherPlayersJson() {
      JsonArray out = new JsonArray();
      ServerPlayer self = agent;
      if (self == null) {
         return out;
      } else {
         for (ServerPlayer other : self.level().getServer().getPlayerList().getPlayers()) {
            if (other != self) {
               JsonObject entry = new JsonObject();
               entry.addProperty("name", other.getName().getString());
               entry.addProperty("x", Math.round(other.getX() * 10.0) / 10.0);
               entry.addProperty("y", Math.round(other.getY() * 10.0) / 10.0);
               entry.addProperty("z", Math.round(other.getZ() * 10.0) / 10.0);
               entry.addProperty("dist", Math.round(self.position().distanceTo(other.position()) * 10.0) / 10.0);
               out.add(entry);
            }
         }

         return out;
      }
   }

   public static JsonObject statusJson() {
      JsonObject out = new JsonObject();
      ServerPlayer self = agent;
      if (self == null) {
         out.addProperty("spawned", false);
         return out;
      } else {
         out.addProperty("spawned", true);
         out.addProperty("removed", self.isRemoved());
         out.addProperty("name", self.nameAndId().name());
         out.addProperty("dimension", self.level().dimension().identifier().toString());
         JsonObject pos = new JsonObject();
         pos.addProperty("x", Math.round(self.getX() * 100.0) / 100.0);
         pos.addProperty("y", Math.round(self.getY() * 100.0) / 100.0);
         pos.addProperty("z", Math.round(self.getZ() * 100.0) / 100.0);
         pos.addProperty("chunk_x", self.chunkPosition().x());
         pos.addProperty("chunk_z", self.chunkPosition().z());
         out.add("pos", pos);
         out.addProperty("health", self.getHealth());
         out.addProperty("gamemode", self.gameMode().getName());
         out.addProperty("selected_slot", self.getInventory().getSelectedSlot());
         Inventory inventory = self.getInventory();
         JsonArray hotbar = new JsonArray();

         for (int slot = 0; slot < Inventory.getSelectionSize(); slot++) {
            hotbar.add(describe(inventory.getItem(slot)));
         }

         out.add("hotbar", hotbar);
         return out;
      }
   }

   private static String displayName() {
      ServerPlayer self = agent;
      return self == null ? "-" : self.nameAndId().name();
   }

   public static boolean connectionState() {
      Connection own = connection;
      return own != null && own.isConnected();
   }

   public static boolean channelOpen() {
      EmbeddedChannel own = channel;
      return own != null && own.isOpen();
   }

   public static int outboundCount() {
      EmbeddedChannel own = channel;
      return own == null ? -1 : own.outboundMessages().size();
   }

   public static boolean hasListener() {
      Connection own = connection;
      return own != null && own.getPacketListener() != null;
   }

   public static void sendInbound(Packet<?> packet) {
      EmbeddedChannel own = channel;
      if (own != null) {
         own.writeInbound(new Object[]{packet});
      }
   }
}
