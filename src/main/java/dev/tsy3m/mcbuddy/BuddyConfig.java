package dev.tsy3m.mcbuddy;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import net.fabricmc.loader.api.FabricLoader;

public final class BuddyConfig {
   public static volatile String agentName = "buddy";
   public static volatile boolean spawnOnLoad = false;
   public static volatile boolean bridgeEnabled = true;
   public static volatile int bridgePort = 25731;
   public static volatile boolean keepTickingWhilePaused = false;
   public static volatile boolean devWrites = false;
   public static volatile String bridgeToken = "";

   public static void reload() {
      Path file = FabricLoader.getInstance().getConfigDir().resolve("mcbuddy.properties");
      Properties props = new Properties();
      if (!Files.exists(file)) {
         try {
            Files.createDirectories(file.getParent());
            Files.writeString(
               file,
               "# display name of the agent player\nagent_name=buddy\n# spawn automatically once the integrated server is up\nspawn_on_load=false\n# local JSON bridge for the MCP facade (loopback only)\nbridge_enabled=true\nbridge_port=25731\n# dev only: keep ticking the integrated server under the pause screen, so the agent\n# can be driven from the bridge without a human opening the world to LAN\nkeep_ticking_while_paused=false\n# dev only: allow the fixture tools to place blocks in already loaded chunks\ndev_writes=false\n# shared secret the bridge demands on every request except `ping`. Empty = no check.\n# Set this before letting an unattended loop (watchdog, agent host) talk to the game.\nbridge_token=\n"
            );
         } catch (IOException var5) {
            Mcbuddy.LOGGER.warn("[mcbuddy] could not write default config", var5);
         }
      } else {
         try (InputStream in = Files.newInputStream(file)) {
            props.load(in);
         } catch (IOException var9) {
            Mcbuddy.LOGGER.warn("[mcbuddy] config unreadable, keeping defaults", var9);
         }

         agentName = props.getProperty("agent_name", "buddy").trim();
         spawnOnLoad = Boolean.parseBoolean(props.getProperty("spawn_on_load", "false").trim());
         bridgeEnabled = Boolean.parseBoolean(props.getProperty("bridge_enabled", "true").trim());
         keepTickingWhilePaused = Boolean.parseBoolean(props.getProperty("keep_ticking_while_paused", "false").trim());
         devWrites = Boolean.parseBoolean(props.getProperty("dev_writes", "false").trim());
         bridgeToken = props.getProperty("bridge_token", "").trim();

         try {
            bridgePort = Integer.parseInt(props.getProperty("bridge_port", "25731").trim());
         } catch (NumberFormatException var6) {
            bridgePort = 25731;
         }
      }
   }
}
