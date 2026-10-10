package dev.tsy3m.mcbuddy.mixin;

import dev.tsy3m.mcbuddy.BuddyAgent;
import net.fabricmc.api.EnvType;
import net.fabricmc.api.Environment;
import net.minecraft.server.level.ServerPlayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Environment(EnvType.CLIENT)
@Mixin({ServerPlayer.class})
public class ServerPlayerTickMixin {
   @Inject(
      method = {"doTick()V"},
      at = {@At("TAIL")}
   )
   private void mcbuddy$drainAgentQueue(CallbackInfo ci) {
      ServerPlayer self = (ServerPlayer)this;
      BuddyAgent.tickPendingSpawn(self);
      BuddyAgent.tickIfAgent(self);
   }
}
