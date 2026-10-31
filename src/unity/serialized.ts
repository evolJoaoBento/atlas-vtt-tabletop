/**
 * Reads a Unity serialized file (the objects inside a bundle) with the type tree the file carries, so the same reader
 * works for every Unity version that writes one. Objects come back as plain data: numbers, strings, byte arrays, arrays
 * and records. A file written without type trees is refused with a reason.
 */
import { ByteReader } from './byteReader';

/** Unity's built-in table of type and field names; a node may name one of these by its offset. */
const COMMON = [
  'AABB', 'AnimationClip', 'AnimationCurve', 'AnimationState', 'Array', 'Base', 'BitField', 'bitset', 'bool', 'char',
  'ColorRGBA', 'Component', 'data', 'deque', 'double', 'dynamic_array', 'FastPropertyName', 'first', 'float', 'Font',
  'GameObject', 'Generic Mono', 'GradientNEW', 'GUID', 'GUIStyle', 'int', 'list', 'long long', 'map', 'Matrix4x4f', 'MdFour', 'MonoBehaviour',
  'MonoScript', 'm_ByteSize', 'm_Curve', 'm_EditorClassIdentifier', 'm_EditorHideFlags', 'm_Enabled', 'm_ExtensionPtr',
  'm_GameObject', 'm_Index', 'm_IsArray', 'm_IsStatic', 'm_MetaFlag', 'm_Name', 'm_ObjectHideFlags', 'm_PrefabInternal',
  'm_PrefabParentObject', 'm_Script', 'm_StaticEditorFlags', 'm_Type', 'm_Version', 'Object', 'pair', 'PPtr<Component>',
  'PPtr<GameObject>', 'PPtr<Material>', 'PPtr<MonoBehaviour>', 'PPtr<MonoScript>', 'PPtr<Object>', 'PPtr<Prefab>',
  'PPtr<Sprite>', 'PPtr<TextAsset>', 'PPtr<Texture>', 'PPtr<Texture2D>', 'PPtr<Transform>', 'Prefab', 'Quaternionf',
  'Rectf', 'RectInt', 'RectOffset', 'second', 'set', 'short', 'size', 'SInt16', 'SInt32', 'SInt64', 'SInt8',
  'staticvector', 'string', 'TextAsset', 'TextMesh', 'Texture', 'Texture2D', 'Transform', 'TypelessData', 'UInt16',
  'UInt32', 'UInt64', 'UInt8', 'unsigned int', 'unsigned long long', 'unsigned short', 'vector', 'Vector2f', 'Vector3f',
  'Vector4f', 'm_ScriptingClassIdentifier', 'Gradient', 'Type*', 'int2_storage', 'int3_storage', 'BoundsInt',
  'm_CorrespondingSourceObject', 'm_PrefabInstance', 'm_PrefabAsset', 'FileSize', 'Hash128',
];
const COMMON_BY_OFFSET = new Map<number, string>();
COMMON.reduce((offset, name) => {
  COMMON_BY_OFFSET.set(offset, name);
  return offset + name.length + 1;
}, 0);

export interface TypeNode {
  readonly type: string;
  readonly name: string;
  readonly level: number;
  readonly metaFlags: number;
  readonly children: TypeNode[];
}

export interface SerializedType {
  readonly classId: number;
  readonly root: TypeNode | null;
}

export interface SerializedObject {
  /** Exact, as text. */
  readonly pathId: string;
  readonly classId: number;
  readonly typeIndex: number;
  readonly start: number;
  readonly size: number;
}

export type Value = number | string | boolean | Uint8Array | Value[] | { [key: string]: Value };
export type Record = { [key: string]: Value };

/** Class ids of the Unity objects Tabletop reads. */
export const CLASS = {
  GameObject: 1, Transform: 4, Material: 21, MeshRenderer: 23, Texture2D: 28, MeshFilter: 33, Mesh: 43,
  SkinnedMeshRenderer: 137,
} as const;

const MAX_OBJECTS = 200_000;
const MAX_NODES = 20_000;
const MAX_ARRAY = 64_000_000;

export class SerializedFile {
  readonly version: number;
  readonly types: SerializedType[] = [];
  readonly objects: SerializedObject[] = [];
  private readonly data: Uint8Array;
  private readonly dataOffset: number;
  private readonly littleEndian: boolean;

  constructor(data: Uint8Array) {
    this.data = data;
    const reader = new ByteReader(data);
    reader.littleEndian = false;
    reader.u32(); // metadata size
    reader.u32(); // file size
    this.version = reader.u32();
    this.dataOffset = reader.u32();
    if (this.version < 17 || this.version > 21) throw new Error(`the Unity files inside are format ${this.version}, which Tabletop does not read.`);
    this.littleEndian = reader.u8() === 0;
    reader.take(3);
    reader.littleEndian = this.littleEndian;
    reader.cString(); // the Unity version that wrote it
    reader.i32(); // target platform
    const hasTypeTree = reader.u8() !== 0;
    if (!hasTypeTree) throw new Error('the bundle has no type information, so its meshes cannot be read.');
    const typeCount = reader.i32();
    if (typeCount < 0 || typeCount > MAX_OBJECTS) throw new Error('the bundle is damaged.');
    for (let i = 0; i < typeCount; i++) this.types.push(this.readType(reader));
    const objectCount = reader.i32();
    if (objectCount < 0 || objectCount > MAX_OBJECTS) throw new Error('the bundle is damaged.');
    for (let i = 0; i < objectCount; i++) {
      reader.align(4);
      const pathId = reader.id64();
      const start = reader.u32();
      const size = reader.u32();
      const typeIndex = reader.i32();
      const type = this.types[typeIndex];
      if (!type) throw new Error('the bundle is damaged.');
      this.objects.push({ pathId, classId: type.classId, typeIndex, start, size });
    }
  }

  private readType(reader: ByteReader): SerializedType {
    const classId = reader.i32();
    reader.u8(); // stripped
    reader.i16(); // script type index
    if (classId === 114) reader.take(16);
    reader.take(16);
    const nodeCount = reader.i32();
    const stringSize = reader.i32();
    if (nodeCount < 0 || nodeCount > MAX_NODES || stringSize < 0 || stringSize > 1 << 24) throw new Error('the bundle is damaged.');
    const raw: Array<{ level: number; typeOffset: number; nameOffset: number; metaFlags: number }> = [];
    for (let i = 0; i < nodeCount; i++) {
      reader.u16(); // node version
      const level = reader.u8();
      reader.u8(); // type flags
      const typeOffset = reader.u32();
      const nameOffset = reader.u32();
      reader.i32(); // byte size
      reader.i32(); // index
      const metaFlags = reader.i32();
      if (this.version >= 19) reader.take(8); // a hash for references
      raw.push({ level, typeOffset, nameOffset, metaFlags });
    }
    const strings = reader.take(stringSize);
    const text = (offset: number): string => {
      if (offset & 0x80000000) return COMMON_BY_OFFSET.get(offset & 0x7fffffff) ?? '?';
      let end = offset;
      while (end < strings.length && strings[end] !== 0) end++;
      return new TextDecoder().decode(strings.subarray(offset, end));
    };
    const stack: TypeNode[] = [];
    let root: TypeNode | null = null;
    for (const entry of raw) {
      const node: TypeNode = { type: text(entry.typeOffset), name: text(entry.nameOffset), level: entry.level, metaFlags: entry.metaFlags, children: [] };
      while (stack.length > entry.level) stack.pop();
      if (stack.length > 0) stack[stack.length - 1].children.push(node);
      else root ??= node;
      stack.push(node);
    }
    return { classId, root };
  }

  /** What an object holds, read with its type tree. */
  read(object: SerializedObject): Record {
    const root = this.types[object.typeIndex].root;
    if (!root) throw new Error('the bundle has no type information, so its meshes cannot be read.');
    const reader = new ByteReader(this.data, this.dataOffset + object.start);
    reader.littleEndian = this.littleEndian;
    const value = this.readNode(reader, root);
    return typeof value === 'object' && !(value instanceof Uint8Array) && !Array.isArray(value) ? value : {};
  }

  private readNode(reader: ByteReader, node: TypeNode): Value {
    let value: Value;
    switch (node.type) {
      case 'SInt8': value = reader.i8(); break;
      case 'UInt8': case 'char': value = reader.u8(); break;
      case 'short': case 'SInt16': value = reader.i16(); break;
      case 'UInt16': case 'unsigned short': value = reader.u16(); break;
      case 'int': case 'SInt32': value = reader.i32(); break;
      case 'UInt32': case 'unsigned int': value = reader.u32(); break;
      case 'long long': case 'SInt64': case 'UInt64': case 'unsigned long long': {
        // A reference's id is exact text; a size or count that fits a number is one.
        const id = reader.id64();
        value = Math.abs(Number(id)) <= Number.MAX_SAFE_INTEGER ? Number(id) : id;
        break;
      }
      case 'float': value = reader.f32(); break;
      case 'double': value = reader.f64(); break;
      case 'bool': value = reader.u8() !== 0; break;
      case 'string': {
        const length = reader.i32();
        if (length < 0 || length > 1 << 26) throw new Error('the bundle is damaged.');
        value = new TextDecoder().decode(reader.take(length));
        reader.align(4);
        return value;
      }
      case 'TypelessData': {
        const size = reader.i32();
        if (size < 0 || size > MAX_ARRAY) throw new Error('the bundle is damaged.');
        value = reader.take(size);
        break;
      }
      default: {
        const only = node.children.length === 1 ? node.children[0] : null;
        if (node.type === 'Array' || (only && only.type === 'Array')) {
          const array = node.type === 'Array' ? node : only!;
          const size = reader.i32();
          const element = array.children[1];
          if (size < 0 || size > MAX_ARRAY || !element) throw new Error('the bundle is damaged.');
          if (element.type === 'UInt8' || element.type === 'SInt8' || element.type === 'char') {
            value = reader.take(size);
          } else {
            const items: Value[] = [];
            for (let i = 0; i < size; i++) items.push(this.readNode(reader, element));
            value = items;
          }
          if ((array.metaFlags & 0x4000) !== 0) reader.align(4);
        } else {
          const record: Record = {};
          for (const child of node.children) record[child.name] = this.readNode(reader, child);
          value = record;
        }
      }
    }
    if ((node.metaFlags & 0x4000) !== 0) reader.align(4);
    return value;
  }
}
