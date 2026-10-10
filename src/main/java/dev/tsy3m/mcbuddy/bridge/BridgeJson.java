package dev.tsy3m.mcbuddy.bridge;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

public final class BridgeJson {
   public static JsonObject parse(String line) {
      try {
         JsonElement element = JsonParser.parseString(line);
         return element.isJsonObject() ? element.getAsJsonObject() : null;
      } catch (RuntimeException var21) {
         return null;
      }
   }

   public static Integer idOf(JsonObject request) {
      return request.has("id") && request.get("id").isJsonPrimitive() ? request.get("id").getAsInt() : null;
   }

   public static String methodOf(JsonObject request) {
      return request.has("method") && request.get("method").isJsonPrimitive() ? request.get("method").getAsString() : "";
   }

   public static String result(Integer id, JsonObject payload) {
      JsonObject envelope = new JsonObject();
      envelope.addProperty("ok", true);
      if (id != null) {
         envelope.addProperty("id", id);
      }

      envelope.add("result", payload);
      return envelope.toString();
   }

   public static String error(Integer id, String message) {
      JsonObject envelope = new JsonObject();
      envelope.addProperty("ok", false);
      if (id != null) {
         envelope.addProperty("id", id);
      }

      envelope.addProperty("error", message);
      return envelope.toString();
   }

   public static String withId(JsonObject request, JsonObject payload) {
      return result(idOf(request), payload);
   }

   public static int intParam(JsonObject request, String name, int fallback) {
      JsonObject params = request.has("params") && request.get("params").isJsonObject() ? request.getAsJsonObject("params") : null;
      if (params != null && params.has(name) && params.get(name).isJsonPrimitive()) {
         try {
            return params.get(name).getAsInt();
         } catch (RuntimeException var5) {
            return fallback;
         }
      } else {
         return fallback;
      }
   }

   public static String stringParam(JsonObject request, String name, String fallback) {
      JsonObject params = paramsOf(request);
      if (params != null && params.has(name) && params.get(name).isJsonPrimitive()) {
         String value = params.get(name).getAsString().trim();
         if (!value.isEmpty()) {
            return value;
         }
      }

      return fallback;
   }

   public static long longParam(JsonObject request, String name, long fallback) {
      JsonObject params = paramsOf(request);
      if (params != null && params.has(name) && params.get(name).isJsonPrimitive()) {
         try {
            return params.get(name).getAsLong();
         } catch (RuntimeException var6) {
            return fallback;
         }
      } else {
         return fallback;
      }
   }

   public static double doubleParam(JsonObject request, String name, double fallback) {
      JsonObject params = paramsOf(request);
      if (params != null && params.has(name) && params.get(name).isJsonPrimitive()) {
         try {
            return params.get(name).getAsDouble();
         } catch (RuntimeException var6) {
            return fallback;
         }
      } else {
         return fallback;
      }
   }

   public static boolean boolParam(JsonObject request, String name, boolean fallback) {
      JsonObject params = paramsOf(request);
      if (params != null && params.has(name) && params.get(name).isJsonPrimitive()) {
         try {
            return params.get(name).getAsBoolean();
         } catch (RuntimeException var5) {
            return fallback;
         }
      } else {
         return fallback;
      }
   }

   public static boolean hasParam(JsonObject request, String name) {
      JsonObject params = paramsOf(request);
      return params != null && params.has(name);
   }

   private static JsonObject paramsOf(JsonObject request) {
      return request.has("params") && request.get("params").isJsonObject() ? request.getAsJsonObject("params") : null;
   }
}
