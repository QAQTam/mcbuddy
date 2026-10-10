package dev.tsy3m.mcbuddy.bridge;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import net.minecraft.core.SectionPos;
import net.minecraft.core.BlockPos.MutableBlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.chunk.LevelChunkSection;

public final class WorldDigest {
   private static final int MAX_COLUMN = 24;
   private static final int MAX_FIND_RADIUS = 16;
   private static final int MAX_FIND_MATCHES = 10;

   public static JsonObject of(MinecraftServer server, int blockX, int blockZ, int chunkRadius, int maxEntries) {
      JsonObject out = new JsonObject();
      ServerLevel level = server.getLevel(Level.OVERWORLD);
      if (level == null) {
         out.addProperty("error", "no overworld");
         return out;
      } else {
         int centerChunkX = blockX >> 4;
         int centerChunkZ = blockZ >> 4;
         Map<String, Integer> counts = new HashMap<>();
         int[] air = new int[1];
         int loaded = 0;
         int absent = 0;
         int span = chunkRadius * 2 + 1;

         for (int dx = -chunkRadius; dx <= chunkRadius; dx++) {
            for (int dz = -chunkRadius; dz <= chunkRadius; dz++) {
               LevelChunk chunk = level.getChunkSource().getChunkNow(centerChunkX + dx, centerChunkZ + dz);
               if (chunk == null) {
                  absent++;
               } else {
                  loaded++;

                  for (int index = 0; index < chunk.getSectionsCount(); index++) {
                     LevelChunkSection section = chunk.getSection(index);
                     if (!section.hasOnlyAir()) {
                        section.getStates().count((state, amount) -> {
                           if (state.isAir()) {
                              air[0] += amount;
                           } else {
                              counts.merge(state.getBlock().getDescriptionId(), amount, Integer::sum);
                           }
                        });
                     }
                  }
               }
            }
         }

         List<Entry<String, Integer>> ordered = new ArrayList<>(counts.entrySet());
         ordered.sort(Comparator.<Entry<String, Integer>>comparingInt(entryx -> (Integer)entryx.getValue()).reversed());
         JsonArray blocks = new JsonArray();

         for (Entry<String, Integer> entry : ordered.subList(0, Math.min(maxEntries, ordered.size()))) {
            JsonArray pair = new JsonArray();
            pair.add(stripPrefix(entry.getKey()));
            pair.add(entry.getValue());
            blocks.add(pair);
         }

         JsonObject chunks = new JsonObject();
         chunks.addProperty("loaded", loaded);
         chunks.addProperty("absent", absent);
         chunks.addProperty("requested", span * span);
         out.addProperty("center_block_x", blockX);
         out.addProperty("center_block_z", blockZ);
         out.addProperty("chunk_radius", chunkRadius);
         out.add("chunks", chunks);
         out.addProperty("air", air[0]);
         out.add("blocks", blocks);
         out.addProperty("truncated", ordered.size() > maxEntries);
         out.addProperty("distinct_blocks", ordered.size());
         return out;
      }
   }

   public static JsonObject find(MinecraftServer server, String wanted, int blockX, int blockZ, int yFrom, int yTo, int radius) {
      JsonObject out = new JsonObject();
      ServerLevel level = server.getLevel(Level.OVERWORLD);
      if (level == null) {
         out.addProperty("error", "no overworld");
         return out;
      } else {
         String needle = wanted.startsWith("minecraft:") ? wanted.substring("minecraft:".length()) : wanted;
         int r = Math.max(1, Math.min(16, radius));
         int low = Math.max(level.getMinY(), Math.min(yFrom, yTo));
         int high = Math.min(level.getMaxY() - 1, Math.max(yFrom, yTo));
         MutableBlockPos probe = new MutableBlockPos();
         List<JsonObject> found = new ArrayList<>();
         int columns = 0;
         int absent = 0;

         for (int dx = -r; dx <= r; dx++) {
            for (int dz = -r; dz <= r; dz++) {
               int x = blockX + dx;
               int z = blockZ + dz;
               LevelChunk chunk = level.getChunkSource().getChunkNow(SectionPos.blockToSectionCoord(x), SectionPos.blockToSectionCoord(z));
               if (chunk == null) {
                  absent++;
               } else {
                  columns++;

                  for (int y = low; y <= high; y++) {
                     probe.set(x, y, z);
                     String id = bare(chunk.getBlockState(probe).getBlock());
                     if (id.equals(needle)) {
                        JsonObject hit = new JsonObject();
                        hit.addProperty("x", x);
                        hit.addProperty("y", y);
                        hit.addProperty("z", z);
                        hit.addProperty("dist", Math.round(Math.hypot(dx, dz) * 10.0) / 10.0);
                        found.add(hit);
                     }
                  }
               }
            }
         }

         found.sort(Comparator.comparingDouble(hitx -> hitx.get("dist").getAsDouble()));
         JsonArray matches = new JsonArray();

         for (JsonObject hit : found.subList(0, Math.min(10, found.size()))) {
            matches.add(hit);
         }

         out.addProperty("query", needle);
         out.addProperty("center_x", blockX);
         out.addProperty("center_z", blockZ);
         out.addProperty("radius", r);
         out.addProperty("y_from", low);
         out.addProperty("y_to", high);
         out.addProperty("columns_loaded", columns);
         out.addProperty("columns_absent", absent);
         out.addProperty("total_matches", found.size());
         out.add("matches", matches);
         out.addProperty("truncated", found.size() > 10);
         return out;
      }
   }

   private static String bare(Block block) {
      String id = BuiltInRegistries.BLOCK.getKey(block).toString();
      int colon = id.indexOf(58);
      return colon >= 0 ? id.substring(colon + 1) : id;
   }

   private static String stripPrefix(String descriptionId) {
      int dot = descriptionId.lastIndexOf(46);
      return dot >= 0 ? descriptionId.substring(dot + 1) : descriptionId;
   }

   public static JsonObject column(MinecraftServer server, int blockX, int blockZ, int yFrom, int yTo) {
      JsonObject out = new JsonObject();
      ServerLevel level = server.getLevel(Level.OVERWORLD);
      if (level == null) {
         out.addProperty("error", "no overworld");
         return out;
      } else {
         LevelChunk chunk = level.getChunkSource().getChunkNow(SectionPos.blockToSectionCoord(blockX), SectionPos.blockToSectionCoord(blockZ));
         if (chunk == null) {
            out.addProperty("x", blockX);
            out.addProperty("z", blockZ);
            out.addProperty("loaded", false);
            return out;
         } else {
            int low = Math.max(level.getMinY(), Math.min(yFrom, yTo));
            int high = Math.min(level.getMaxY() - 1, Math.max(yFrom, yTo));
            MutableBlockPos probe = new MutableBlockPos();
            JsonArray rows = new JsonArray();

            for (int y = low; y <= high && rows.size() < 24; y++) {
               probe.set(blockX, y, blockZ);
               rows.add(y + " " + chunk.getBlockState(probe).getBlock().getDescriptionId());
            }

            out.addProperty("x", blockX);
            out.addProperty("z", blockZ);
            out.addProperty("loaded", true);
            out.add("column", rows);
            out.addProperty("truncated", high - low + 1 > 24);
            return out;
         }
      }
   }
}
