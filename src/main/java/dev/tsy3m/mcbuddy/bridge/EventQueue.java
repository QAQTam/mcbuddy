package dev.tsy3m.mcbuddy.bridge;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.ArrayDeque;

public final class EventQueue {
   private static final int CAPACITY = 256;
   private static final ArrayDeque<EventQueue.Entry> ENTRIES = new ArrayDeque<>();
   private static long sequence;

   public static synchronized void add(String type, JsonObject data) {
      ENTRIES.addLast(new EventQueue.Entry(++sequence, type, data));

      while (ENTRIES.size() > 256) {
         ENTRIES.removeFirst();
      }
   }

   public static synchronized JsonObject poll(long cursor) {
      JsonArray events = new JsonArray();
      long newest = cursor;

      for (EventQueue.Entry entry : ENTRIES) {
         if (entry.seq() > cursor) {
            JsonObject wrapper = new JsonObject();
            wrapper.addProperty("seq", entry.seq());
            wrapper.addProperty("type", entry.type());
            wrapper.add("data", entry.data());
            events.add(wrapper);
            newest = entry.seq();
         }
      }

      JsonObject result = new JsonObject();
      result.addProperty("cursor", newest);
      result.add("events", events);
      long dropped = sequence - (ENTRIES.isEmpty() ? 0L : ENTRIES.peekFirst().seq());
      if (dropped > 0L) {
         result.addProperty("older_than_cursor_dropped", (int)dropped);
      }

      return result;
   }

   public static synchronized long latest() {
      return sequence;
   }

   private record Entry(long seq, String type, JsonObject data) {
   }
}
