package dev.tsy3m.mcbuddy;

import com.mojang.logging.LogUtils;
import dev.tsy3m.mcbuddy.bridge.BridgeServer;
import net.fabricmc.api.ClientModInitializer;
import org.slf4j.Logger;

public class Mcbuddy implements ClientModInitializer {
   public static final Logger LOGGER = LogUtils.getLogger();

   public void onInitializeClient() {
      BuddyConfig.reload();
      BridgeServer.start();
      LOGGER.info("[mcbuddy] M1 initialised - agent '{}' bridge={}", BuddyConfig.agentName, BuddyConfig.bridgeEnabled);
   }
}
