package dev.tsy3m.mcbuddy;

import net.minecraft.client.Minecraft;

/** Client-only detached "director" camera: overrides the vanilla camera each frame. */
public final class FreeCam {
   private FreeCam() {
   }

   public static volatile boolean ACTIVE = false;
   public static volatile double x;
   public static volatile double y;
   public static volatile double z;
   public static volatile float yaw;
   public static volatile float pitch;

   public static void activate(double px, double py, double pz, float yRot, float xRot) {
      x = px;
      y = py;
      z = pz;
      yaw = yRot;
      pitch = xRot;
      Minecraft.getInstance().execute(() -> ACTIVE = true);
   }

   public static void set(double px, double py, double pz, float yRot, float xRot) {
      x = px;
      y = py;
      z = pz;
      yaw = yRot;
      pitch = xRot;
   }

   public static void deactivate() {
      Minecraft.getInstance().execute(() -> ACTIVE = false);
   }
}
