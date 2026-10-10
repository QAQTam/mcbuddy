package dev.tsy3m.mcbuddy.bridge;

import com.google.gson.JsonObject;
import dev.tsy3m.mcbuddy.BuddyAgent;
import dev.tsy3m.mcbuddy.BuddyConfig;
import dev.tsy3m.mcbuddy.Mcbuddy;
import net.minecraft.core.BlockPos;
import net.minecraft.core.SectionPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Blocks;

public final class WorldFixture {
   private static final int MAX_RADIUS = 8;

   public static JsonObject pad(MinecraftServer server, int requestedRadius) {
      JsonObject out = new JsonObject();
      if (!BuddyConfig.devWrites) {
         out.addProperty("written", false);
         out.addProperty("reason", "dev_writes is off");
         return out;
      } else {
         ServerPlayer self = BuddyAgent.current();
         ServerLevel level = server.getLevel(Level.OVERWORLD);
         if (self != null && level != null) {
            int radius = Math.max(1, Math.min(8, requestedRadius));
            BlockPos centre = self.blockPosition();
            int changed = 0;
            int skipped = 0;

            for (int dx = -radius; dx <= radius; dx++) {
               for (int dz = -radius; dz <= radius; dz++) {
                  BlockPos floor = centre.offset(dx, -1, dz);
                  if (!loaded(level, floor)) {
                     skipped++;
                  } else {
                     if (level.setBlock(floor, Blocks.STONE.defaultBlockState(), 3, 512)) {
                        changed++;
                     }

                     level.setBlock(floor.above(), Blocks.AIR.defaultBlockState(), 3, 512);
                     level.setBlock(floor.above(2), Blocks.AIR.defaultBlockState(), 3, 512);
                  }
               }
            }

            out.addProperty("written", true);
            out.addProperty("centre", centre.getX() + "," + centre.getY() + "," + centre.getZ());
            out.addProperty("radius", radius);
            out.addProperty("blocks_changed", changed);
            out.addProperty("columns_outside_loaded_chunks", skipped);
            Mcbuddy.LOGGER.info("[mcbuddy] fixture pad at {} radius {} changed {} blocks", new Object[]{centre, radius, changed});
            return out;
         } else {
            out.addProperty("written", false);
            out.addProperty("reason", "no agent or no overworld");
            return out;
         }
      }
   }

   private static boolean loaded(ServerLevel level, BlockPos pos) {
      return pos.getY() >= level.getMinY() && pos.getY() <= level.getMaxY() - 1
         ? level.getChunkSource().getChunkNow(SectionPos.blockToSectionCoord(pos.getX()), SectionPos.blockToSectionCoord(pos.getZ())) != null
         : false;
   }
}
