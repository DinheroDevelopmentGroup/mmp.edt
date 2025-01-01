import { PublicEventHandler } from '../../util/events.js';
import type { Packet } from '../../util/packet.js';
import type { AsyncVoid } from '../../util/types.js';
import proxy from '../internal.proxy/local.js';
import Entity from '../prismarine.entity/local.js';
import registry from '../prismarine.registry/local.js';

// #region Types

// #region Packet

interface DownstreamSpawnEntityPacketData {
  entityId: number;
  objectUUID: string;
  type: number;
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  headPitch: number;
  objectData: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
}

interface DownstreamNamedEntitySpawnPacketData {
  entityId: number;
  playerUUID: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

interface DownstreamEntityVelocityPacketData {
  entityId: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
}

interface DownstreamEntityDestroyPacketData {
  entityIds: number[];
}

interface DownstreamRelativeEntityMovePacketData {
  entityId: number;
  dX: number;
  dY: number;
  dZ: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
}

interface DownstreamEntityLookPacketData {
  entityId: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
}

interface DownstreamEntityTeleportPacketData {
  entityId: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
}

interface PacketPhysicsState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
}

// #endregion

// #region Conversion

function euclidianMod(numerator: number, denominator: number): number {
  const result = numerator % denominator;

  return result < 0 ? result + denominator : result;
}

const PI = Math.PI;
const TAU = 2 * PI;
const DEG_TO_RAD = TAU / 360;
const RAD_TO_DEG = 360 / TAU;
const NOTCH_BYTE_TO_RAD = 360 / 256;
// Notchian Byte -> blocks/s
const NOTCH_BYTE_VELOCITY_TO_BPS = 1 / 8000;

function toRadians(angle: number): number {
  return angle * DEG_TO_RAD;
}

function toDegrees(angle: number): number {
  return angle * RAD_TO_DEG;
}

function decodeNotchianYaw(deg: number): number {
  return euclidianMod(PI - toRadians(deg), TAU);
}

function decodeNotchianYawByte(byte: number): number {
  return decodeNotchianYaw(byte * NOTCH_BYTE_TO_RAD);
}

function decodeNotchianPitch(deg: number): number {
  return euclidianMod(toRadians(-deg) + PI, TAU) - PI;
}

function decodeNotchianPitchByte(byte: number): number {
  return decodeNotchianPitch(byte * NOTCH_BYTE_TO_RAD);
}

function decodeNotchianVelocityByte(byte: number): number {
  return byte * NOTCH_BYTE_VELOCITY_TO_BPS;
}

// #endregion

const entities = new Map<number, Entity>();

function getEntity(id: number): Entity {
  let entity = entities.get(id);
  if (entity === undefined) {
    entities.set(id, (entity = new Entity(id)));
  }

  return entity;
}

function setEntityDataByType(entity: Entity, typeId: number): void {
  const data = registry.entities[typeId];

  if (data !== undefined) {
    entity.type = data.type;
    entity.displayName = data.displayName;
    entity.entityType = data.id;
    entity.name = data.name;
    entity.kind = data.category;
    entity.height = data.height;
    entity.width = data.width;
  } else {
    entity.type = 'other';
    entity.entityType = typeId;
    entity.mobType = 'unknown';
    entity.displayName = 'unknown';
    entity.name = 'unknown';
    entity.kind = 'unknown';
  }
}

function setEntityPose(entity: Entity, pose: PacketPhysicsState): void {
  if (registry.supportFeature('fixedPointPosition')) {
    entity.position.set(pose.x / 32, pose.y / 32, pose.z / 32);
  } else if (registry.supportFeature('doublePosition')) {
    entity.position.set(pose.x, pose.y, pose.z);
  }

  entity.yaw = decodeNotchianYawByte(pose.yaw);
  entity.pitch = decodeNotchianPitchByte(pose.pitch);

  entity.velocity.x = decodeNotchianVelocityByte(pose.velocityX);
  entity.velocity.y = decodeNotchianVelocityByte(pose.velocityY);
  entity.velocity.z = decodeNotchianVelocityByte(pose.velocityZ);
}

function addEntity(
  id: number,
  uuid: string,
  type: number,
  pose: PacketPhysicsState,
): void {
  const entity = getEntity(id);
  entity.uuid = uuid;
  setEntityDataByType(entity, type);
  setEntityPose(entity, pose);
}

// #region Proxy

proxy.downstream.on(
  'spawn_entity',
  async (packet: Packet<DownstreamSpawnEntityPacketData>) => {
    addEntity(
      packet.data.entityId,
      packet.data.objectUUID,
      packet.data.type,
      packet.data,
    );

    await edt.emit('entity.spawn', getEntity(packet.data.entityId), packet);
  },
);

// proxy.downstream.on(
//   'named_entity_spawn',
//   async (packet: Packet<DownstreamNamedEntitySpawnPacketData>) => {
//     addEntity(
//       packet.data.entityId,
//       packet.data.playerUUID,
//       registry.entitiesByName.player.id,
//       packet.data,
//     );

//     await edt.emit('entity.spawn', getEntity(packet.data.entityId), packet);
//   },
// );

proxy.downstream.on(
  'entity_velocity',
  async (packet: Packet<DownstreamEntityVelocityPacketData>) => {
    const entity = getEntity(packet.data.entityId);
    if (entity === undefined)
      throw new Error(`Unknown entity: ${packet.data.entityId}`);

    entity.velocity.x = decodeNotchianVelocityByte(packet.data.velocityX);
    entity.velocity.y = decodeNotchianVelocityByte(packet.data.velocityY);
    entity.velocity.z = decodeNotchianVelocityByte(packet.data.velocityZ);

    await edt.emit('entity.velocity', entity, packet);
  },
);

proxy.downstream.on(
  'entity_destroy',
  async (packet: Packet<DownstreamEntityDestroyPacketData>) => {
    for (const id of packet.data.entityIds) {
      const entity = getEntity(id);
      entity.isValid = false;
      entities.delete(id);

      await edt.emit('entity.destroy', entity, packet);
    }
  },
);

async function onRelativeEntityMovement(
  packet: Packet<DownstreamRelativeEntityMovePacketData>,
): Promise<void> {
  const entity = getEntity(packet.data.entityId);

  if (registry.supportFeature('fixedPointDelta')) {
    entity.position.translate(
      packet.data.dX / 32,
      packet.data.dY / 32,
      packet.data.dZ / 32,
    );
  } else {
    entity.position.translate(
      packet.data.dX / (128 * 32),
      packet.data.dY / (128 * 32),
      packet.data.dZ / (128 * 32),
    );
  }

  await edt.emit('entity.position', entity, packet);
}

async function onEntityLook(
  packet: Packet<DownstreamEntityLookPacketData>,
): Promise<void> {
  const entity = getEntity(packet.data.entityId);

  entity.yaw = decodeNotchianYawByte(packet.data.yaw);
  entity.pitch = decodeNotchianPitchByte(packet.data.pitch);

  await edt.emit('entity.look', entity, packet);
}

proxy.downstream.on('rel_entity_move', onRelativeEntityMovement);
proxy.downstream.on('entity_look', onEntityLook);
proxy.downstream.on('entity_move_look', async (packet) => {
  await onRelativeEntityMovement(packet);
  await onEntityLook(packet);
});

proxy.downstream.on(
  'entity_teleport',
  async (packet: Packet<DownstreamEntityTeleportPacketData>) => {
    const entity = getEntity(packet.data.entityId);

    if (registry.supportFeature('fixedPointPosition')) {
      entity.position.set(
        packet.data.x / 32,
        packet.data.y / 32,
        packet.data.z / 32,
      );
    } else if (registry.supportFeature('doublePosition')) {
      entity.position.set(packet.data.x, packet.data.y, packet.data.z);
    }

    entity.yaw = decodeNotchianYawByte(packet.data.yaw);
    entity.pitch = decodeNotchianPitchByte(packet.data.pitch);

    await edt.emit('entity.teleport', entity, packet);
  },
);

// #endregion

interface EventMap {
  'entity.spawn': (
    entity: Entity,
    packet: Packet<DownstreamSpawnEntityPacketData>,
  ) => AsyncVoid;
  'entity.destroy': (
    entity: Entity,
    packet: Packet<DownstreamEntityDestroyPacketData>,
  ) => AsyncVoid;

  'entity.velocity': (
    entity: Entity,
    packet: Packet<DownstreamEntityVelocityPacketData>,
  ) => AsyncVoid;

  'entity.position': (
    entity: Entity,
    packet: Packet<
      | DownstreamRelativeEntityMovePacketData
      | DownstreamEntityTeleportPacketData
    >,
  ) => AsyncVoid;

  'entity.look': (
    entity: Entity,
    packet: Packet<DownstreamEntityLookPacketData>,
  ) => AsyncVoid;

  'entity.teleport': (
    entity: Entity,
    packet: Packet<DownstreamEntityTeleportPacketData>,
  ) => AsyncVoid;
}

class EDTPlugin extends PublicEventHandler<EventMap> {
  public getEntityById(id: number): Entity | undefined {
    return entities.get(id);
  }

  public getEntities(): Entity[] {
    return Array.from(entities.values());
  }
}

export const edt = new EDTPlugin();

export default edt;
