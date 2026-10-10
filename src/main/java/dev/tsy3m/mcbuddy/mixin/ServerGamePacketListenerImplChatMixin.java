package dev.tsy3m.mcbuddy.mixin;

import com.google.gson.JsonObject;
import dev.tsy3m.mcbuddy.bridge.EventQueue;
import net.fabricmc.api.EnvType;
import net.fabricmc.api.Environment;
import net.minecraft.network.protocol.game.ServerboundChatPacket;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Environment(EnvType.CLIENT)
@Mixin({ServerGamePacketListenerImpl.class})
public class ServerGamePacketListenerImplChatMixin {
   @Shadow
   public ServerPlayer player;

   @Inject(
      method = {"handleChat(Lnet/minecraft/network/protocol/game/ServerboundChatPacket;)V"},
      at = {@At("TAIL")}
   )
   private void mcbuddy$captureChat(ServerboundChatPacket packet, CallbackInfo ci) {
      JsonObject event = new JsonObject();
      event.addProperty("from", this.player.nameAndId().name());
      event.addProperty("text", packet.message());
      EventQueue.add("chat", event);
   }
}
