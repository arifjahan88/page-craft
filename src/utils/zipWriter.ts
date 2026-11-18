// ─── High-Performance Zero-Dependency ZIP Archive Generator ─────────────────
// Implements PKZip 2.0 specification with standard Store (Method 0) containerization.
// Ideal for pre-compressed media (PNG, JPG, WebP) with instantaneous execution.

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c;
}

export function crc32(data: Uint8Array): number {
  let crc = -1;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function getDosDateTime(date: Date = new Date()): { time: number; date: number } {
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: dosTime, date: dosDate };
}

export interface ZipFileInput {
  name: string;
  data: Uint8Array | Blob;
}

interface ProcessedFile {
  nameBytes: Uint8Array;
  dataBytes: Uint8Array;
  crc: number;
  offset: number;
}

export async function createZipArchive(files: ZipFileInput[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const { time: dosTime, date: dosDate } = getDosDateTime();

  const processed: ProcessedFile[] = [];
  const parts: BlobPart[] = [];
  let currentOffset = 0;

  // 1. Process files and write Local Headers + Data
  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    let dataBytes: Uint8Array;

    if (file.data instanceof Blob) {
      dataBytes = new Uint8Array(await file.data.arrayBuffer());
    } else {
      dataBytes = file.data;
    }

    const fileCrc = crc32(dataBytes);
    const offset = currentOffset;

    // Local file header (30 bytes + name length)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);

    view.setUint32(0, 0x04034b50, true); // Local header signature
    view.setUint16(4, 20, true); // Version needed to extract (2.0)
    view.setUint16(6, 0x0800, true); // General purpose bit flag (UTF-8)
    view.setUint16(8, 0, true); // Compression method (0 = Store)
    view.setUint16(10, dosTime, true); // Last mod file time
    view.setUint16(12, dosDate, true); // Last mod file date
    view.setUint32(14, fileCrc, true); // CRC-32
    view.setUint32(18, dataBytes.length, true); // Compressed size
    view.setUint32(22, dataBytes.length, true); // Uncompressed size
    view.setUint16(26, nameBytes.length, true); // File name length
    view.setUint16(28, 0, true); // Extra field length

    localHeader.set(nameBytes, 30);

    parts.push(localHeader);
    parts.push(dataBytes as unknown as BlobPart);

    currentOffset += localHeader.length + dataBytes.length;

    processed.push({
      nameBytes,
      dataBytes,
      crc: fileCrc,
      offset,
    });
  }

  // 2. Central Directory Headers
  const centralDirStartOffset = currentOffset;
  let centralDirSize = 0;

  for (const file of processed) {
    const cdHeader = new Uint8Array(46 + file.nameBytes.length);
    const view = new DataView(cdHeader.buffer);

    view.setUint32(0, 0x02014b50, true); // Central directory header signature
    view.setUint16(4, 20, true); // Version made by (2.0)
    view.setUint16(6, 20, true); // Version needed to extract (2.0)
    view.setUint16(8, 0x0800, true); // General purpose bit flag (UTF-8)
    view.setUint16(10, 0, true); // Compression method (0 = Store)
    view.setUint16(12, dosTime, true); // Last mod file time
    view.setUint16(14, dosDate, true); // Last mod file date
    view.setUint32(16, file.crc, true); // CRC-32
    view.setUint32(20, file.dataBytes.length, true); // Compressed size
    view.setUint32(24, file.dataBytes.length, true); // Uncompressed size
    view.setUint16(28, file.nameBytes.length, true); // File name length
    view.setUint16(30, 0, true); // Extra field length
    view.setUint16(32, 0, true); // File comment length
    view.setUint16(34, 0, true); // Disk number start
    view.setUint16(36, 0, true); // Internal file attributes
    view.setUint32(38, 0x81a40000, true); // External file attributes (regular file permissions)
    view.setUint32(42, file.offset, true); // Relative offset of local header

    cdHeader.set(file.nameBytes, 46);

    parts.push(cdHeader);
    centralDirSize += cdHeader.length;
  }

  // 3. End of Central Directory Record (EOCD - 22 bytes)
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);

  eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
  eocdView.setUint16(4, 0, true); // Number of this disk
  eocdView.setUint16(6, 0, true); // Disk where central directory starts
  eocdView.setUint16(8, processed.length, true); // Number of central directory records on this disk
  eocdView.setUint16(10, processed.length, true); // Total central directory records
  eocdView.setUint32(12, centralDirSize, true); // Size of central directory
  eocdView.setUint32(16, centralDirStartOffset, true); // Offset of central directory
  eocdView.setUint16(20, 0, true); // Comment length

  parts.push(eocd);

  return new Blob(parts, { type: "application/zip" });
}
