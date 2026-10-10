package dev.tsy3m.mcbuddy.mixin;

import dev.tsy3m.mcbuddy.BuddyAgent;
import net.fabricmc.api.EnvType;
import net.fabricmc.api.Environment;
import net.minecraft.network.Connection;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.players.PlayerList;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Environment(EnvType.CLIENT)
@Mixin({PlayerList.class})
public class PlayerListJoinMixin {
   @Inject(
      method = {"placeNewPlayer(Lnet/minecraft/network/Connection;Lnet/minecraft/server/level/ServerPlayer;Lnet/minecraft/server/network/CommonListenerCookie;)V"},
      at = {@At("TAIL")}
   )
   private void mcbuddy$onHumanJoined(Connection connection, ServerPlayer player, CommonListenerCookie cookie, CallbackInfo ci) {
      BuddyAgent.onPlayerPlaced(player);
   }
}
