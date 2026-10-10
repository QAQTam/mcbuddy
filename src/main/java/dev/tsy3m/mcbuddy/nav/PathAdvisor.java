package dev.tsy3m.mcbuddy.nav;

import dev.tsy3m.mcbuddy.Mcbuddy;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.level.PathNavigationRegion;
import net.minecraft.world.level.pathfinder.Path;
import net.minecraft.world.level.pathfinder.PathFinder;
import net.minecraft.world.level.pathfinder.PathType;
import net.minecraft.world.level.pathfinder.WalkNodeEvaluator;
import net.minecraft.world.phys.Vec3;
import org.jspecify.annotations.Nullable;

public final class PathAdvisor {
   private static final int MAX_VISITED_NODES = 960;
   private static final long NO_GO_TICKS = 100L;
   private static final Map<Long, Long> NO_GO = new HashMap<>();
   private static final PathFinder FINDER = new PathFinder(new PathAdvisor.NoGoEvaluator(), 960);
   @Nullable
   private static Mob advisor;
   @Nullable
   private static ServerLevel advisorLevel;

   public static void forbid(ServerLevel level, BlockPos pos) {
      long tick = level.getServer().getTickCount();
      NO_GO.put(BlockPos.asLong(pos.getX(), pos.getY(), pos.getZ()), tick + 100L);
      NO_GO.values().removeIf(expiry -> expiry <= tick);
   }

   @Nullable
   public static Path to(ServerLevel level, Vec3 from, Vec3 target, float maxLength) {
      NO_GO.values().removeIf(expiry -> expiry <= level.getServer().getTickCount());
      Mob mob = advisorFor(level, from);
      if (mob == null) {
         return null;
      } else {
         mob.setPos(from.x, from.y, from.z);
         BlockPos center = BlockPos.containing(from);
         int radius = (int)Math.ceil(maxLength) + 2;
         PathNavigationRegion region = new PathNavigationRegion(level, center.offset(-radius, -radius, -radius), center.offset(radius, radius, radius));
         Path path = FINDER.findPath(region, mob, Set.of(BlockPos.containing(target)), maxLength, 0, 1.0F);
         Mcbuddy.LOGGER
            .info(
               "[mcbuddy] path {} -> {}: {}",
               new Object[]{
                  center,
                  BlockPos.containing(target),
                  path == null ? "null" : "nodes=" + path.getNodeCount() + " reach=" + path.canReach() + " end=" + path.getEndNode()
               }
            );
         return path;
      }
   }

   @Nullable
   private static Mob advisorFor(ServerLevel level, Vec3 from) {
      if (advisor == null || advisorLevel != level) {
         advisor = (Mob)EntityTypes.COW.create(level, EntitySpawnReason.TRIGGERED);
         advisorLevel = level;
      }

      Mob mob = advisor;
      if (mob != null) {
         mob.setPos(from.x, from.y, from.z);
      }

      return mob;
   }

   private static final class NoGoEvaluator extends WalkNodeEvaluator {
      protected PathType getCachedPathType(int x, int y, int z) {
         return PathAdvisor.NO_GO.containsKey(BlockPos.asLong(x, y, z)) ? PathType.BLOCKED : super.getCachedPathType(x, y, z);
      }
   }
}
