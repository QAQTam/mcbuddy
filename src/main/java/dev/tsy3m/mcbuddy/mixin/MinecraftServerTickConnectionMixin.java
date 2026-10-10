package dev.tsy3m.mcbuddy.mixin;

import dev.tsy3m.mcbuddy.BuddyAgent;
import dev.tsy3m.mcbuddy.BuddyConfig;
import dev.tsy3m.mcbuddy.bridge.BridgeServer;
import dev.tsy3m.mcbuddy.Mcbuddy;
import net.fabricmc.api.EnvType;
import net.fabricmc.api.Environment;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.server.MinecraftServer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Environment(EnvType.CLIENT)
@Mixin({MinecraftServer.class})
public class MinecraftServerTickConnectionMixin {
   @Inject(
      method = {"tickConnection()V"},
      at = {@At("TAIL")}
   )
   private void mcbuddy$tickAgent(CallbackInfo ci) {
      if (!((Object)this instanceof IntegratedServer server && server.isPaused() && !BuddyConfig.keepTickingWhilePaused)) {
         try {
            BuddyAgent.tickAgentConnection();
         } catch (Throwable t) {
            Mcbuddy.LOGGER.error("[mcbuddy] agent tick failed", t);
         }

         try {
            BridgeServer.tick();
         } catch (Throwable t) {
            Mcbuddy.LOGGER.error("[mcbuddy] bridge tick failed", t);
         }
      }
   }
}
