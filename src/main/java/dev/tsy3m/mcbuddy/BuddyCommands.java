package dev.tsy3m.mcbuddy;

import com.mojang.brigadier.context.CommandContext;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;

public final class BuddyCommands {
   private static final String INVISIBLE_SPACE = "[\\u00A0\\u2000-\\u200F\\u202F\\u205F\\u3000\\uFEFF]";

   public static int handle(CommandContext<CommandSourceStack> ctx) {
      return respond(ctx, (String)ctx.getArgument("text", String.class));
   }

   public static int usage(CommandContext<CommandSourceStack> ctx) {
      return respond(ctx, "");
   }

   private static int respond(CommandContext<CommandSourceStack> ctx, String text) {
      String answer = run(((CommandSourceStack)ctx.getSource()).getServer(), text.isEmpty() ? "buddy" : "buddy " + text);
      if (answer.startsWith("usage:")) {
         answer = answer + " [服务端收到 原文码点=" + codes(ctx.getInput()) + " 参数=\"" + text + "\" 参数码点=" + codes(text) + "]";
      }

      ((CommandSourceStack)ctx.getSource()).sendSystemMessage(Component.literal("[mcbuddy] " + answer));
      return 1;
   }

   private static String codes(String s) {
      StringBuilder out = new StringBuilder();
      s.codePoints().forEach(cp -> out.append(Integer.toHexString(cp)).append('.'));
      return out.toString();
   }

   public static String run(MinecraftServer server, String message) {
      String[] parts = message.replaceAll("[\\u00A0\\u2000-\\u200F\\u202F\\u205F\\u3000\\uFEFF]", " ").trim().split("\\s+", 3);
      String verb = parts.length > 1 ? parts[1].toLowerCase() : "help";
      String rest = parts.length > 2 ? parts[2] : "";

      return switch (verb) {
         case "spawn" -> BuddyAgent.spawn(server, BuddyConfig.agentName);
         case "remove" -> BuddyAgent.remove(server);
         case "here" -> BuddyAgent.teleportToPlayer(server);
         case "come" -> BuddyAgent.comeToPlayer(server);
         case "say" -> BuddyAgent.sayFromCommand(server, rest);
         case "status" -> BuddyAgent.status();
         default -> "usage: /buddy spawn | remove | here | come | say <text> | status";
      };
   }
}
