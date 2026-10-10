package dev.tsy3m.mcbuddy.mixin;

import net.fabricmc.api.EnvType;
import net.fabricmc.api.Environment;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.world.phys.Vec3;
import org.jspecify.annotations.Nullable;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Environment(EnvType.CLIENT)
@Mixin({ServerGamePacketListenerImpl.class})
public interface ServerGamePacketListenerImplTeleportAccessor {
   @Accessor("awaitingTeleport")
   int mcbuddy$awaitingTeleport();

   @Accessor("awaitingPositionFromClient")
   @Nullable
   Vec3 mcbuddy$awaitingPositionFromClient();
}
