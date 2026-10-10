package dev.tsy3m.mcbuddy.nav;

import com.google.gson.JsonObject;
import dev.tsy3m.mcbuddy.BuddyAgent;
import dev.tsy3m.mcbuddy.Mcbuddy;
import dev.tsy3m.mcbuddy.bridge.EventQueue;
import net.minecraft.core.BlockPos;
import net.minecraft.core.BlockPos.MutableBlockPos;
import net.minecraft.core.Direction.Axis;
import net.minecraft.network.protocol.game.ServerboundClientTickEndPacket;
import net.minecraft.network.protocol.game.ServerboundMovePlayerPacket.PosRot;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.pathfinder.Path;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.phys.shapes.BooleanOp;
import net.minecraft.world.phys.shapes.Shapes;
import net.minecraft.world.phys.shapes.VoxelShape;
import org.jspecify.annotations.Nullable;

public final class WalkTask {
   private static final double STRIDE = 0.35;
   private static final int MAX_CHANGE = 1;
   private static final int SNAP_RISE = 2;
   private static final int SNAP_DROP = 8;
   private static final int[] HEIGHT_LADDER = new int[]{0, 1, -1};
   private static final double JUMP_POWER = 0.42;
   private static final double GRAVITY = 0.08;
   private static final double VERTICAL_DRAG = 0.98;
   private static final int MAX_FALL = 24;
   private static final int MAX_JUMPS = 3;
   private static final int AIRBORNE_LIMIT = 30;
   private static final int AIRBORNE_BUDGET = 60;
   private static final int AIRBORNE_RESERVE = 20;
   private static final double ARC_REACH = 4.0;
   private static final double ARC_PROBE_STEP = 0.5;
   private static final double DETOUR_MARGIN = 2.0;
   private static final int TICK_LIMIT = 1200;
   private static final int STUCK_WINDOW = 20;
   private static final double STUCK_MIN_PROGRESS = 0.5;
   private static final int STUCK_LIMIT = 40;
   private static final int WEDGE_LIMIT = 12;
   private static final double CLOSE_LIMIT = 3.5;
   private static final int CLOSE_TICKS = 20;
   private static final int MAX_PATH_LENGTH = 60;
   @Nullable
   private static WalkTask current;
   private static int nextId = 1;
   private final int id;
   private Path path;
   private final Vec3 target;
   private final double straightLine;
   private int ticks;
   private Vec3 checkpoint;
   private int checkpointTick;
   private int stuckTicks;
   private boolean repathed;
   private int refused;
   private int degraded;
   private int risen;
   private int dropped;
   private float healthStart;
   private boolean airborne;
   private boolean straight;
   private boolean replanOnLanding;
   private double jumpY;
   private double vy;
   private int airborneTicks;
   private int airborneTotal;
   private int jumps;
   private int jumped;
   private int refusalStreak;
   private boolean closing;
   private int closeDeadline;
   @Nullable
   private String wedgeDetail;

   private WalkTask(int id, Path path, Vec3 target, Vec3 from) {
      this.id = id;
      this.path = path;
      this.target = target;
      this.straightLine = planar(from, target);
   }

   @Nullable
   public static WalkTask current() {
      return current;
   }

   public static JsonObject start(ServerLevel level, Vec3 from, Vec3 requestedTarget, boolean snapToSurface) {
      JsonObject out = new JsonObject();
      if (current != null) {
         out.addProperty("accepted", false);
         out.addProperty("reason", "busy with task " + current.id);
         return out;
      } else {
         Vec3 target = snapToSurface ? surfaceSnapped(level, from, requestedTarget) : requestedTarget;
         Path path = PathAdvisor.to(level, from, target, 60.0F);
         if (path != null && path.getNodeCount() > 1) {
            WalkTask task = new WalkTask(nextId++, path, target, from);
            current = task;
            out.addProperty("accepted", true);
            out.addProperty("task_id", task.id);
            out.addProperty("exact_target", path.canReach());
            out.addProperty("straight_line_blocks", Math.round(task.straightLine * 10.0) / 10.0);
            out.addProperty("est_ticks_lower_bound", (int)Math.ceil(task.straightLine / 0.35));
            Mcbuddy.LOGGER
               .info(
                  "[mcbuddy] walk task {} accepted: exact={} straight={} target={}",
                  new Object[]{task.id, path.canReach(), Math.round(task.straightLine * 10.0) / 10.0, target}
               );
            return out;
         } else {
            out.addProperty("accepted", false);
            out.addProperty("reason", BlockPos.containing(from).equals(BlockPos.containing(target)) ? "already_at_target" : "pathfinder produced no route");
            return out;
         }
      }
   }

   public static void tick(ServerPlayer agent) {
      WalkTask task = current;
      if (task != null) {
         task.ticks++;
         if (task.ticks == 1) {
            task.healthStart = agent.getHealth();
         }

         Vec3 here = agent.position();
         if (!task.airborne) {
            BlockPos feet = BlockPos.containing(here);
            BlockPos goal = BlockPos.containing(task.target);
            if (feet.getX() == goal.getX() && feet.getZ() == goal.getZ() && Math.abs(feet.getY() - goal.getY()) <= 1) {
               finish(agent, task, "reached");
               return;
            }

            if (task.path.isDone()) {
               double remaining = planar(here, task.target);
               if (task.closing) {
                  if (task.ticks > task.closeDeadline) {
                     finish(agent, task, "stopped_short");
                     return;
                  }
               } else {
                  if (!(remaining <= 3.5)) {
                     finish(agent, task, "stopped_short");
                     return;
                  }

                  task.closing = true;
                  task.closeDeadline = task.ticks + 20;
               }
            }

            if (task.ticks > 1200) {
               finish(agent, task, "timeout");
               return;
            }
         }

         if (task.checkpoint == null || task.ticks - task.checkpointTick >= 20) {
            if (task.checkpoint != null && planar(here, task.checkpoint) < 0.5) {
               task.stuckTicks += 20;
            } else {
               task.stuckTicks = 0;
            }

            task.checkpoint = here;
            task.checkpointTick = task.ticks;
         }

         if (task.stuckTicks >= 40) {
            if (task.repathed) {
               finish(agent, task, "stuck");
               return;
            }

            task.repathed = true;
            task.stuckTicks = 0;
            Path again = PathAdvisor.to(agent.level(), here, task.target, 60.0F);
            if (again == null || again.getNodeCount() <= 1) {
               finish(agent, task, "stuck_no_alternative");
               return;
            }

            task.path = again;
            Mcbuddy.LOGGER.info("[mcbuddy] task {} stuck at {}, repathing", task.id, here);
         }

         Vec3 next = task.closing ? task.target : task.nextNodePos(agent);
         if (next == null) {
            finish(agent, task, "no_next_node");
         } else {
            Vec3 toNode = clampStride(here, next);
            Vec3 toTarget = clampStride(here, task.target);
            if (!task.airborne) {
               task.considerLeavingRoute(agent, here, task.path.getNextNodeIndex());
            }

            Vec3[] headings = task.straight ? new Vec3[]{toTarget} : new Vec3[]{toNode, toTarget};
            WalkTask.Claim claim = task.airborne ? task.airStride(agent, here, headings) : groundStride(agent, task, here, headings);
            if (claim.blocked() && task.enterAir(agent, here, headings)) {
               claim = task.airStride(agent, here, headings);
            }

            Vec3 stepped = claim.at();
            String via = claim.via();
            boolean refusedNow = claim.blocked();
            if (refusedNow) {
               task.refused++;
               BlockPos blamed = claim.blocker();
               if (blamed == null && claim.sawClear()) {
                  blamed = BlockPos.containing(toNode.x, here.y, toNode.z);
               }

               task.noteWedge(agent, toNode, claim.sawClear() ? "no footing" : "blocked");
               if (blamed != null) {
                  PathAdvisor.forbid(agent.level(), blamed);
               }
            } else if (!task.airborne) {
               task.jumps = 0;
            }

            task.refusalStreak = refusedNow ? task.refusalStreak + 1 : 0;
            if (task.refusalStreak >= 12) {
               if (task.repathed) {
                  finish(agent, task, "wedged");
                  return;
               }

               task.repathed = true;
               task.refusalStreak = 0;
               Path around = PathAdvisor.to(agent.level(), here, task.target, 60.0F);
               if (around == null || around.getNodeCount() <= 1) {
                  finish(agent, task, "wedged_no_alternative");
                  return;
               }

               task.path = around;
               Mcbuddy.LOGGER.info("[mcbuddy] task {} wedged at {}, routing around", task.id, here);
            }

            if (task.ticks <= 8 || !"level".equals(via)) {
               Mcbuddy.LOGGER
                  .info(
                     "[mcbuddy] task {} stride {}: {} -> {} via {}{}",
                     new Object[]{task.id, task.ticks, here, stepped, via, task.airborne ? " (vy " + Math.round(task.vy * 1000.0) / 1000.0 + ")" : ""}
                  );
            }

            float yaw = (float)Math.toDegrees(-Math.atan2(stepped.x - here.x, stepped.z - here.z));
            BuddyAgent.sendInbound(new PosRot(stepped.x, stepped.y, stepped.z, wrap(yaw), agent.getXRot(), claim.ground(), agent.horizontalCollision));
            BuddyAgent.sendInbound(ServerboundClientTickEndPacket.INSTANCE);
            advanceIfClose(agent, task);
            if (task.replanOnLanding) {
               task.replanOnLanding = false;
               Vec3 landed = agent.position();
               Path onward = PathAdvisor.to(agent.level(), landed, task.target, 60.0F);
               if (onward != null && onward.getNodeCount() > 1) {
                  task.path = onward;
                  Mcbuddy.LOGGER.info("[mcbuddy] task {} crossed to {}, replanning from there", task.id, landed);
               }
            }
         }
      }
   }

   private Vec3 nextNodePos(ServerPlayer agent) {
      return this.path.getNextNodeIndex() < this.path.getNodeCount() ? this.path.getNextEntityPos(agent) : this.target;
   }

   private static WalkTask.Claim groundStride(ServerPlayer agent, WalkTask task, Vec3 here, Vec3[] headings) {
      BlockPos blocker = null;
      boolean sawClear = false;

      for (Vec3 candidate : headings) {
         for (int dy : HEIGHT_LADDER) {
            Vec3 wanted = new Vec3(candidate.x, here.y + dy, candidate.z);
            AABB hit = firstNewCollision(agent, wanted);
            if (hit != null) {
               if (blocker == null) {
                  blocker = BlockPos.containing(hit.getCenter());
               }
            } else {
               sawClear = true;
               if (hasFooting(agent.level(), agent, wanted)) {
                  if (dy > 0) {
                     task.risen++;
                  } else if (dy < 0) {
                     task.dropped++;
                  }

                  task.degraded += dy == 0 ? 0 : 1;
                  return new WalkTask.Claim(wanted, agent.onGround(), viaName(dy, candidate == headings[0]), null, true);
               }
            }
         }
      }

      return new WalkTask.Claim(here, agent.onGround(), "blocked", blocker, sawClear);
   }

   private void considerLeavingRoute(ServerPlayer agent, Vec3 here, int nodeIndex) {
      if (this.jumps < 3 && this.airborneTotal + 20 <= 60) {
         double straight = planar(here, this.target);
         double route = this.remainingRoute(agent, nodeIndex, here);
         if (!(route - straight < 2.0)) {
            Vec3 landing = this.gapAhead(agent, here);
            if (landing != null) {
               this.airborne = true;
               this.straight = true;
               this.jumpY = here.y;
               this.jumps++;
               this.jumped++;
               this.airborneTicks = 0;
               this.vy = 0.42;
               Mcbuddy.LOGGER
                  .info(
                     "[mcbuddy] task {} leaves the route at {}: straight={} route={} landing={}",
                     new Object[]{this.id, here, Math.round(straight * 10.0) / 10.0, Math.round(route * 10.0) / 10.0, landing}
                  );
            }
         }
      }
   }

   private double remainingRoute(ServerPlayer agent, int nodeIndex, Vec3 here) {
      double total = 0.0;
      Vec3 from = here;

      for (int i = nodeIndex; i < this.path.getNodeCount(); i++) {
         BlockPos node = this.path.getNodePos(i);
         Vec3 at = new Vec3(node.getX() + 0.5, node.getY(), node.getZ() + 0.5);
         total += planar(from, at);
         from = at;
      }

      return total;
   }

   @Nullable
   private Vec3 gapAhead(ServerPlayer agent, Vec3 here) {
      double dx = this.target.x - here.x;
      double dz = this.target.z - here.z;
      double planar = Math.hypot(dx, dz);
      if (planar < 0.001) {
         return null;
      } else {
         double ux = dx / planar;
         double uz = dz / planar;
         boolean overHole = false;
         ServerLevel level = agent.level();

         for (double d = 0.5; d <= Math.min(planar, 4.0) + 0.5; d += 0.5) {
            Vec3 at = new Vec3(here.x + ux * d, here.y, here.z + uz * d);
            boolean groundHere = groundAt(level, at.x, at.y, at.z);
            boolean groundBelow = groundAt(level, at.x, at.y - 1.0, at.z);
            if (groundHere || groundBelow) {
               if (!overHole) {
                  return null;
               } else {
                  Vec3 landing = new Vec3(at.x, groundHere ? here.y : here.y - 1.0, at.z);
                  return freeAt(agent, landing) ? landing : null;
               }
            }

            overHole = true;
         }

         return null;
      }
   }

   private boolean enterAir(ServerPlayer agent, Vec3 here, Vec3[] headings) {
      if (!this.airborne && this.jumps < 3 && this.airborneTotal + 20 <= 60) {
         for (Vec3 heading : headings) {
            if (groundUnder(agent, here.y, heading.x, heading.z) != null) {
               this.airborne = true;
               this.jumpY = here.y;
               this.jumps++;
               this.jumped++;
               this.airborneTicks = 0;
               this.vy = -0.08;
               return true;
            }
         }

         return false;
      } else {
         return false;
      }
   }

   private WalkTask.Claim airStride(ServerPlayer agent, Vec3 here, Vec3[] headings) {
      if (this.airborneTicks >= 30) {
         this.airborne = false;
         this.straight = false;
         this.vy = 0.0;
         return new WalkTask.Claim(here, agent.onGround(), "blocked", null, true);
      } else {
         this.airborneTicks++;
         this.airborneTotal++;
         double rise = this.vy;
         this.vy = (this.vy - 0.08) * 0.98;
         double nextY = here.y + rise;
         boolean descending = this.vy < 0.0;
         if (descending) {
            for (Vec3 heading : headings) {
               double surface = sweptSurface(agent, here.y, nextY, heading.x, heading.z);
               if (!(surface <= nextY + 1.0E-5)) {
                  Vec3 landed = new Vec3(heading.x, surface, heading.z);
                  if (firstNewCollision(agent, landed) == null && (!this.straight || !(Math.abs(surface - this.jumpY) > 1.00001))) {
                     this.airborne = false;
                     if (this.straight) {
                        this.replanOnLanding = true;
                     }

                     this.straight = false;
                     this.vy = 0.0;
                     return new WalkTask.Claim(landed, true, "landed", null, true);
                  }
               }
            }
         }

         for (Vec3 candidate : headings) {
            Vec3 arcing = new Vec3(candidate.x, nextY, candidate.z);
            AABB hit = firstNewCollision(agent, arcing);
            if (hit == null) {
               return new WalkTask.Claim(arcing, false, descending ? "arc down" : "arc up", null, true);
            }

            Vec3 sliding = new Vec3(here.x, nextY, here.z);
            if (firstNewCollision(agent, sliding) == null) {
               return new WalkTask.Claim(sliding, false, descending ? "arc down along wall" : "arc up along wall", null, true);
            }
         }

         if (!descending) {
            this.vy = 0.0;
         }

         Vec3 stalled = new Vec3(headings[0].x, here.y, headings[0].z);
         AABB stalledHit = firstNewCollision(agent, stalled);
         return stalledHit == null
            ? new WalkTask.Claim(stalled, false, "arc stalled", null, true)
            : new WalkTask.Claim(here, false, "blocked", BlockPos.containing(stalledHit.getCenter()), true);
      }
   }

   private static boolean groundAt(ServerLevel level, double x, double y, double z) {
      BlockPos below = BlockPos.containing(x, y - 1.0, z);
      return !level.getBlockState(below).getCollisionShape(level, below).isEmpty();
   }

   private static double sweptSurface(ServerPlayer agent, double fromY, double toY, double x, double z) {
      ServerLevel level = agent.level();
      AABB box = agent.getBoundingBox().move(x - agent.getX(), 0.0, z - agent.getZ());
      int minX = (int)Math.floor(box.minX + 1.0E-5);
      int maxX = (int)Math.floor(box.maxX - 1.0E-5);
      int minZ = (int)Math.floor(box.minZ + 1.0E-5);
      int maxZ = (int)Math.floor(box.maxZ - 1.0E-5);
      double surface = toY;
      MutableBlockPos probe = new MutableBlockPos();

      for (int cy = (int)Math.floor(fromY); cy >= (int)Math.floor(toY) - 1; cy--) {
         for (int cx = minX; cx <= maxX; cx++) {
            for (int cz = minZ; cz <= maxZ; cz++) {
               VoxelShape shape = shapeTop(level, probe.set(cx, cy, cz));
               if (!shape.isEmpty()) {
                  double top = cy + shape.max(Axis.Y);
                  if (top > surface && top <= fromY + 1.0E-5) {
                     surface = top;
                  }
               }
            }
         }
      }

      return surface;
   }

   @Nullable
   private static Double groundUnder(ServerPlayer agent, double fromY, double x, double z) {
      int top = (int)Math.floor(fromY + 1.0E-5);
      ServerLevel level = agent.level();

      for (int y = top; y > top - 24; y--) {
         Vec3 probe = new Vec3(x, y, z);
         if (freeAt(agent, probe) && groundAt(level, x, y, z)) {
            return (double)y;
         }
      }

      return null;
   }

   private static boolean freeAt(ServerPlayer agent, Vec3 to) {
      AABB box = agent.getBoundingBox().move(to.x - agent.getX(), to.y - agent.getY(), to.z - agent.getZ());
      return agent.level().noCollision(agent, box);
   }

   @Nullable
   private static AABB firstNewCollision(ServerPlayer agent, Vec3 to) {
      AABB oldAABB = agent.getBoundingBox();
      AABB newAABB = oldAABB.move(to.x - agent.getX(), to.y - agent.getY(), to.z - agent.getZ());
      VoxelShape oldShape = Shapes.create(oldAABB.deflate(1.0E-5));

      for (VoxelShape shape : agent.level().getPreMoveCollisions(agent, newAABB.deflate(1.0E-5), oldAABB.getBottomCenter())) {
         if (!Shapes.joinIsNotEmpty(shape, oldShape, BooleanOp.AND)) {
            return shape.bounds();
         }
      }

      return null;
   }

   private void noteWedge(ServerPlayer agent, Vec3 wanted, String why) {
      if (this.wedgeDetail == null) {
         ServerLevel level = agent.level();
         if (!"blocked".equals(why)) {
            BlockPos below = BlockPos.containing(wanted.x, agent.getY() - 1.0, wanted.z);
            this.wedgeDetail = "no footing; below="
               + bare(level.getBlockState(below).getBlock().getDescriptionId())
               + "@"
               + below.getX()
               + ","
               + below.getY()
               + ","
               + below.getZ();
         } else {
            AABB hit = firstNewCollision(agent, wanted);
            if (hit == null) {
               this.wedgeDetail = "our predicate found nothing; the server disagreed for another reason";
            } else {
               BlockPos at = BlockPos.containing(hit.getCenter());
               String block = bare(level.getBlockState(at).getBlock().getDescriptionId());
               int entities = level.getEntities(agent, hit, other -> true).size();
               this.wedgeDetail = block + "@" + at.getX() + "," + at.getY() + "," + at.getZ() + " entities=" + entities;
            }
         }
      }
   }

   private static String bare(String descriptionId) {
      int colon = descriptionId.indexOf(58);
      return colon >= 0 ? descriptionId.substring(colon + 1) : descriptionId;
   }

   private static void advanceIfClose(ServerPlayer agent, WalkTask task) {
      int index = task.path.getNextNodeIndex();
      if (index < task.path.getNodeCount()) {
         BlockPos node = task.path.getNodePos(index);
         Vec3 nodeCenter = new Vec3(node.getX() + 0.5, node.getY(), node.getZ() + 0.5);
         if (planar(agent.position(), nodeCenter) < 0.7) {
            task.path.advance();
         }
      }
   }

   private static double planar(Vec3 a, Vec3 b) {
      return new Vec3(b.x - a.x, 0.0, b.z - a.z).horizontalDistance();
   }

   private static Vec3 surfaceSnapped(ServerLevel level, Vec3 from, Vec3 target) {
      BlockPos column = BlockPos.containing(target);
      int feet = BlockPos.containing(from).getY();

      for (int y = feet + 2; y >= feet - 8; y--) {
         BlockPos here = new BlockPos(column.getX(), y, column.getZ());
         BlockPos head = here.above();
         BlockPos below = here.below();
         if (!level.getBlockState(below).getCollisionShape(level, below).isEmpty()
            && level.getBlockState(here).getCollisionShape(level, here).isEmpty()
            && level.getBlockState(head).getCollisionShape(level, head).isEmpty()) {
            return new Vec3(target.x, y, target.z);
         }
      }

      return new Vec3(target.x, feet, target.z);
   }

   private static Vec3 clampStride(Vec3 from, Vec3 to) {
      double dx = to.x - from.x;
      double dz = to.z - from.z;
      double planar = Math.sqrt(dx * dx + dz * dz);
      if (planar > 0.35) {
         double scale = 0.35 / planar;
         dx *= scale;
         dz *= scale;
      }

      return new Vec3(from.x + dx, from.y, from.z + dz);
   }

   private static String viaName(int dy, boolean onRoute) {
      String height = dy > 0 ? "step up" : (dy < 0 ? "step down" : "level");
      return onRoute ? height : height + " toward target";
   }

   private static boolean hasFooting(ServerLevel level, ServerPlayer agent, Vec3 to) {
      AABB box = agent.getBoundingBox().move(to.x - agent.getX(), to.y - agent.getY(), to.z - agent.getZ());
      int minX = (int)Math.floor(box.minX + 1.0E-5);
      int maxX = (int)Math.floor(box.maxX - 1.0E-5);
      int minZ = (int)Math.floor(box.minZ + 1.0E-5);
      int maxZ = (int)Math.floor(box.maxZ - 1.0E-5);
      int support = BlockPos.containing(to.x, to.y - 1.0E-5, to.z).getY();
      MutableBlockPos probe = new MutableBlockPos();

      for (int x = minX; x <= maxX; x++) {
         for (int z = minZ; z <= maxZ; z++) {
            if (!shapeTop(level, probe.set(x, support, z)).isEmpty()) {
               return true;
            }
         }
      }

      return false;
   }

   private static VoxelShape shapeTop(ServerLevel level, BlockPos pos) {
      return level.getBlockState(pos).getCollisionShape(level, pos);
   }

   private static float wrap(float degrees) {
      return (float)((degrees + 180.0) % 360.0 - 180.0);
   }

   private static void finish(ServerPlayer agent, WalkTask task, String status) {
      current = null;
      JsonObject event = new JsonObject();
      event.addProperty("task_id", task.id);
      event.addProperty("status", status);
      event.addProperty("ticks", task.ticks);
      event.addProperty("straight_line_blocks", Math.round(task.straightLine * 10.0) / 10.0);
      Vec3 ended = agent.position();
      event.addProperty("strides_refused", task.refused);
      event.addProperty("strides_degraded", task.degraded);
      event.addProperty("strides_risen", task.risen);
      event.addProperty("strides_dropped", task.dropped);
      event.addProperty("jumps", task.jumped);
      event.addProperty("airborne_ticks", task.airborneTotal);
      event.addProperty("health", agent.getHealth());
      event.addProperty("health_lost", Math.round((task.healthStart - agent.getHealth()) * 10.0) / 10.0);
      if (task.wedgeDetail != null) {
         event.addProperty("blocked_by", task.wedgeDetail);
      }

      event.addProperty("x", Math.round(ended.x * 10.0) / 10.0);
      event.addProperty("y", Math.round(ended.y * 10.0) / 10.0);
      event.addProperty("z", Math.round(ended.z * 10.0) / 10.0);
      EventQueue.add("walk", event);
      Mcbuddy.LOGGER
         .info(
            "[mcbuddy] walk task {} -> {} after {} ticks at {} (refused={} risen={} dropped={} health={} -{})",
            new Object[]{
               task.id,
               status,
               task.ticks,
               ended,
               task.refused,
               task.risen,
               task.dropped,
               agent.getHealth(),
               Math.round((task.healthStart - agent.getHealth()) * 10.0) / 10.0
            }
         );
   }

   private record Claim(Vec3 at, boolean ground, String via, @Nullable BlockPos blocker, boolean sawClear) {
      boolean blocked() {
         return "blocked".equals(this.via);
      }
   }
}
