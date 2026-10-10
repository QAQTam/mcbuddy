package dev.tsy3m.mcbuddy.mixin;

import dev.tsy3m.mcbuddy.BuddyAgent;
import dev.tsy3m.mcbuddy.ConnectionProbe;
import net.fabricmc.api.EnvType;
import net.fabricmc.api.Environment;
import net.minecraft.network.protocol.game.ServerboundSetCarriedItemPacket;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Environment(EnvType.CLIENT)
@Mixin({ServerGamePacketListenerImpl.class})
public class ServerGamePacketListenerImplInboundMixin {
   @Shadow
   public ServerPlayer player;

   @Inject(
      method = {"handleSetCarriedItem(Lnet/minecraft/network/protocol/game/ServerboundSetCarriedItemPacket;)V"},
      at = {@At("HEAD")}
   )
   private void mcbuddy$observeInbound(ServerboundSetCarriedItemPacket packet, CallbackInfo ci) {
      if (this.player == BuddyAgent.current()) {
         ConnectionProbe.reportInbound(this.player);
      }
   }
}
