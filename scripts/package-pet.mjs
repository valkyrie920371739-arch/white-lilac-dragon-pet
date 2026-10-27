import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Store the already-compressed PNG in a deterministic, standard ZIP archive.
// The UTF-8 flag and a fixed 1980 timestamp keep it portable and reproducible.
export async function writePetPackage(outputDirectory) {
  const manifest = await readFile(resolve(root, 'desktop-pet.json'));
  const pet = JSON.parse(manifest);
  const entries = [
    ['pet.json', manifest],
    [pet.spritesheetPath, await readFile(resolve(root, 'assets', pet.spritesheetPath))],
    ['README.txt', Buffer.from('白紫龙娘·简约版\n\n将整个 white-lilac-dragon 文件夹放到 ~/.codex/pets/ 下。\nWindows 对应用户目录中的 .codex/pets/。\n然后在 ChatGPT 桌面端「设置 → 宠物」刷新并选择她，输入 /pet 显示。\n桌面宠物与网页端宠物分别管理。\n')],
  ];
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [filename, content] of entries) {
    const name = Buffer.from(`${pet.id}/${filename}`);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc32(content), 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    local.copy(central, 6, 4, 30);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, name, content);
    centralParts.push(central, name);
    offset += local.length + name.length + content.length;
  }
  const directory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  await mkdir(outputDirectory, { recursive: true });
  const output = resolve(outputDirectory, 'white-lilac-dragon-pet.zip');
  await writeFile(output, Buffer.concat([...localParts, directory, end]));
  return output;
}
