package dev.tsy3m.mcbuddy.mixin;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import dev.tsy3m.mcbuddy.BuddyCommands;
import net.minecraft.commands.CommandBuildContext;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.Commands.CommandSelection;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin({Commands.class})
public class CommandsRegisterMixin {
   @Shadow
   private CommandDispatcher<CommandSourceStack> dispatcher;

   @Inject(
      method = {"<init>(Lnet/minecraft/commands/Commands$CommandSelection;Lnet/minecraft/commands/CommandBuildContext;)V"},
      at = {@At("TAIL")}
   )
   private void mcbuddy$register(CommandSelection selection, CommandBuildContext context, CallbackInfo ci) {
      this.dispatcher
         .register(
            (LiteralArgumentBuilder)((LiteralArgumentBuilder)Commands.literal("buddy").executes(BuddyCommands::usage))
               .then(Commands.argument("text", StringArgumentType.greedyString()).executes(BuddyCommands::handle))
         );
   }
}
