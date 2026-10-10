package dev.tsy3m.mcbuddy.mixin;

import dev.tsy3m.mcbuddy.FreeCam;
import net.minecraft.client.Camera;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Detached director camera: after vanilla aligns the camera with the player, override pose. */
@Mixin(Camera.class)
public abstract class CameraMixin {
   @Shadow
   protected abstract void setRotation(float yRot, float xRot);

   @Shadow
   protected abstract void setPosition(double x, double y, double z);

   @Inject(method = "alignWithEntity", at = @At("TAIL"))
   private void mcbuddy$freeCam(float partialTicks, CallbackInfo ci) {
      if (FreeCam.ACTIVE) {
         this.setRotation(FreeCam.yaw, FreeCam.pitch);
         this.setPosition(FreeCam.x, FreeCam.y, FreeCam.z);
      }
   }
}
