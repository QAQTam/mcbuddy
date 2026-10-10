package dev.tsy3m.mcbuddy.bridge;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.List;

public final class EditLog {
   private static final int CAPACITY = 4096;
   private static final int DEFAULT_LIMIT = 200;
   private static final List<EditLog.Entry> ENTRIES = new ArrayList<>();
   private static long sequence;

   public static synchronized long record(String op, int x, int y, int z, String before, String after, String bp, long tick) {
      ENTRIES.add(new EditLog.Entry(++sequence, tick, op, x, y, z, before, after, bp == null ? "" : bp));

      while (ENTRIES.size() > 4096) {
         ENTRIES.removeFirst();
      }

      return sequence;
   }

   private static boolean matches(EditLog.Entry entry, long cursor, String bp) {
      return entry.seq() > cursor && (bp == null || bp.isEmpty() || bp.equals(entry.bp()));
   }

   public static synchronized List<EditLog.Entry> newestFirst(String bp) {
      List<EditLog.Entry> out = new ArrayList<>();

      for (int i = ENTRIES.size() - 1; i >= 0; i--) {
         EditLog.Entry entry = ENTRIES.get(i);
         if (bp == null || bp.isEmpty() || bp.equals(entry.bp())) {
            out.add(entry);
         }
      }

      return out;
   }

   public static synchronized JsonObject query(long cursor, String bp, int limit) {
      int cap = limit <= 0 ? 200 : Math.min(limit, 4096);
      JsonArray edits = new JsonArray();
      int matching = 0;
      int minX = Integer.MAX_VALUE;
      int maxX = Integer.MIN_VALUE;
      int minY = Integer.MAX_VALUE;
      int maxY = Integer.MIN_VALUE;
      int minZ = Integer.MAX_VALUE;
      int maxZ = Integer.MIN_VALUE;
      JsonArray kinds = new JsonArray();
      List<String> seen = new ArrayList<>();

      for (EditLog.Entry entry : ENTRIES) {
         if (matches(entry, cursor, bp)) {
            matching++;
            minX = Math.min(minX, entry.x());
            maxX = Math.max(maxX, entry.x());
            minY = Math.min(minY, entry.y());
            maxY = Math.max(maxY, entry.y());
            minZ = Math.min(minZ, entry.z());
            maxZ = Math.max(maxZ, entry.z());
            if (!seen.contains(entry.after())) {
               seen.add(entry.after());
               kinds.add(entry.after());
            }

            if (edits.size() < cap) {
               JsonObject one = new JsonObject();
               one.addProperty("seq", entry.seq());
               one.addProperty("op", entry.op());
               one.addProperty("x", entry.x());
               one.addProperty("y", entry.y());
               one.addProperty("z", entry.z());
               one.addProperty("from", entry.before());
               one.addProperty("to", entry.after());
               if (!entry.bp().isEmpty()) {
                  one.addProperty("bp", entry.bp());
               }

               edits.add(one);
            }
         }
      }

      JsonObject bounds = new JsonObject();
      if (matching > 0) {
         bounds.addProperty("min", minX + "," + minY + "," + minZ);
         bounds.addProperty("max", maxX + "," + maxY + "," + maxZ);
      }

      JsonObject result = new JsonObject();
      result.addProperty("cursor", sequence);
      result.addProperty("matching", matching);
      result.addProperty("returned", edits.size());
      result.addProperty("truncated", matching > edits.size());
      result.add("bounds", bounds);
      result.add("placed_kinds", kinds);
      result.add("edits", edits);
      return result;
   }

   public static synchronized long latest() {
      return sequence;
   }

   public record Entry(long seq, long tick, String op, int x, int y, int z, String before, String after, String bp) {
   }
}
