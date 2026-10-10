package dev.tsy3m.mcbuddy.mixin;

import net.fabricmc.api.EnvType;
import net.fabricmc.api.Environment;
import net.minecraft.server.network.ServerCommonPacketListenerImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Environment(EnvType.CLIENT)
@Mixin({ServerCommonPacketListenerImpl.class})
public interface ServerCommonPacketListenerImplAccessor {
   @Accessor("keepAlivePending")
   boolean mcbuddy$keepAlivePending();

   @Accessor("keepAliveChallenge")
   long mcbuddy$keepAliveChallenge();
}
