package dev.tsy3m.mcbuddy.mixin;

import dev.tsy3m.mcbuddy.BuddyConfig;
import net.fabricmc.api.EnvType;
import net.fabricmc.api.Environment;
import net.minecraft.client.Minecraft;
import net.minecraft.client.server.IntegratedServer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

@Environment(EnvType.CLIENT)
@Mixin({IntegratedServer.class})
public class IntegratedServerPauseMixin {
   @Redirect(
      method = {"tickServer"},
      at = {@At(
         value = "INVOKE",
         target = "Lnet/minecraft/client/Minecraft;isPaused()Z"
      )}
   )
   private boolean mcbuddy$ignorePause(Minecraft client) {
      return BuddyConfig.keepTickingWhilePaused ? false : client.isPaused();
   }
}
