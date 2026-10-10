package dev.tsy3m.mcbuddy.bridge;

import com.google.gson.JsonObject;
import com.mojang.blaze3d.platform.NativeImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.levelgen.Heightmap;

/** Server-side top-down block map rendered to PNG (no render thread needed). */
public final class WorldMap {
   private WorldMap() {
   }

   public static JsonObject of(ServerLevel level, int centerX, int centerZ, int radius) {
      radius = Math.max(8, Math.min(96, radius));
      int size = radius * 2;
      JsonObject out = new JsonObject();
      NativeImage img = null;
      Path tmp = null;

      try {
         int minH = Integer.MAX_VALUE;
         int maxH = Integer.MIN_VALUE;
         int[] heights = new int[size * size];
         int[] colors = new int[size * size];
         boolean[] valid = new boolean[size * size];

         for (int px = 0; px < size; px++) {
            for (int pz = 0; pz < size; pz++) {
               int wx = centerX - radius + px;
               int wz = centerZ - radius + pz;
               int h = level.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, wx, wz) - 1;
               int idx = pz * size + px;
               if (h < level.getMinY()) {
                  colors[idx] = 0x202020;
                  heights[idx] = level.getMinY();
                  continue;
               }

               valid[idx] = true;
               heights[idx] = h;
               if (h < minH) {
                  minH = h;
               }

               if (h > maxH) {
                  maxH = h;
               }

               BlockState state = level.getBlockState(new BlockPos(wx, h, wz));
               colors[idx] = colorFor(state);
            }
         }

         img = new NativeImage(size, size, false);
         float range = Math.max(1, maxH - minH + 1);

         for (int px = 0; px < size; px++) {
            for (int pz = 0; pz < size; pz++) {
               int idx = pz * size + px;
               if (!valid[idx]) {
                  img.setPixelABGR(px, pz, 0xFF202020);
                  continue;
               }

               int argb = 0xFF000000 | colors[idx];
               // outline where neighbouring columns jump (roof edges, walls, cliffs)
               boolean edge = false;
               for (int[] d : new int[][]{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}) {
                  int nx = px + d[0], nz = pz + d[1];
                  if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
                  int nidx = nz * size + nx;
                  if (valid[nidx] && Math.abs(heights[nidx] - heights[idx]) >= 3) { edge = true; break; }
               }

               int pixel;
               if (edge) {
                  pixel = 0xFF101010;
               } else {
                  float shade = 0.55F + 0.45F * (float)(heights[idx] - minH) / range;
                  int r = (int)Math.min(255.0F, (float)(argb >> 16 & 255) * shade);
                  int g = (int)Math.min(255.0F, (float)(argb >> 8 & 255) * shade);
                  int b = (int)Math.min(255.0F, (float)(argb & 255) * shade);
                  pixel = 0xFF000000 | b << 16 | g << 8 | r;
               }

               img.setPixelABGR(px, pz, pixel);
            }
         }

         tmp = Files.createTempFile("mcbuddy-map-", ".png");
         img.writeToFile(tmp.toFile());
         byte[] bytes = Files.readAllBytes(tmp);
         out.addProperty("format", "png");
         out.addProperty("size", size);
         out.addProperty("center_x", centerX);
         out.addProperty("center_z", centerZ);
         out.addProperty("height_min", minH);
         out.addProperty("height_max", maxH);
         out.addProperty("bytes", bytes.length);
         out.addProperty("data_base64", Base64.getEncoder().encodeToString(bytes));
      } catch (IOException e) {
         out.addProperty("error", e.getMessage());
      } finally {
         if (img != null) {
            img.close();
         }

         if (tmp != null) {
            try {
               Files.deleteIfExists(tmp);
            } catch (IOException ignored) {
            }
         }
      }

      return out;
   }

   private static int colorFor(BlockState state) {
      String id = state.getBlock().getDescriptionId().replace("block.minecraft.", "");
      if (id.contains("grass_block")) return 0x6FA83C;
      if (id.contains("leaves")) return 0x3E7A22;
      if (id.contains("log") || id.contains("wood")) return 0x6B5127;
      if (id.contains("water")) return 0x3D6DF2;
      if (id.contains("diorite")) return 0xE8E6E0;
      if (id.contains("granite")) return 0xC47A5A;
      if (id.contains("andesite")) return 0x8A8A8D;
      if (id.contains("deepslate")) return 0x3F3F45;
      if (id.contains("diorite")) return 0xE8E6E0;
      if (id.contains("stone") || id.contains("cobblestone") || id.contains("bricks")) return 0x8F8F8F;
      if (id.contains("dirt") || id.contains("mud")) return 0x9B6F47;
      if (id.contains("sand")) return 0xDCD3A0;
      if (id.contains("gravel")) return 0x8A8581;
      if (id.contains("snow")) return 0xF2FAFA;
      if (id.contains("ice")) return 0xA5C8F2;
      if (id.contains("copper")) return 0xC06B4E;
      if (id.contains("iron")) return 0xD8AF93;
      if (id.contains("coal")) return 0x393939;
      if (id.contains("gold")) return 0xE8C33C;
      if (id.contains("diamond")) return 0x5AECd8;
      if (id.contains("short_grass") || id.contains("fern") || id.contains("tall_grass")) return 0x7CBD4B;
      if (id.contains("leaf_litter")) return 0x8A7A3A;
      if (id.contains("tuff")) return 0x6D6E62;
      if (id.contains("bedrock")) return 0x161616;
      int hash = id.hashCode();
      return 0xFF000000 | (hash >> 16 & 255) << 16 | (hash >> 8 & 255) << 8 | (hash & 255);
   }
}
