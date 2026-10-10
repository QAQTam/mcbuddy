package dev.tsy3m.mcbuddy;

import net.minecraft.network.protocol.game.ServerboundSetCarriedItemPacket;
import net.minecraft.server.level.ServerPlayer;

public final class ConnectionProbe {
   private static final int PROBE_SLOT = 3;
   private static int ticksSeen;
   private static boolean hookReported;
   private static boolean sent;

   public static void onAgentTick(ServerPlayer self) {
      ticksSeen++;
      if (!hookReported) {
         hookReported = true;
         Mcbuddy.LOGGER.info("[mcbuddy] probe: agent doTick hook fires (clientLoaded={})", self.connection.hasClientLoaded());
      }

      if (ticksSeen == 60) {
         Mcbuddy.LOGGER
            .info(
               "[mcbuddy] probe: connected={} channelOpen={} outboundQueue={} hasListener={}",
               new Object[]{BuddyAgent.connectionState(), BuddyAgent.channelOpen(), BuddyAgent.outboundCount(), BuddyAgent.hasListener()}
            );
      }

      if (ticksSeen == 100 && !sent) {
         sent = true;
         Mcbuddy.LOGGER.info("[mcbuddy] probe: before send selectedSlot={}", self.getInventory().getSelectedSlot());
         BuddyAgent.sendInbound(new ServerboundSetCarriedItemPacket(3));
      }

      if (ticksSeen == 101) {
         int slot = self.getInventory().getSelectedSlot();
         Mcbuddy.LOGGER.info("[mcbuddy] probe: after send selectedSlot={} -> {}", slot, slot == 3 ? "INBOUND PATH WORKS" : "inbound had no effect");
      }
   }

   public static void reportInbound(ServerPlayer sender) {
      Mcbuddy.LOGGER.info("[mcbuddy] probe: handleSetCarriedItem reached for agent '{}'", sender.nameAndId().name());
   }
}
