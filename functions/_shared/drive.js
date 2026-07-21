/**
 * Google Drive 操作模組
 * 讀取 skills/ 和 memory/，以及建立 Google Docs 文件
 *
 * 所有內容都放在共用雲端硬碟（Shared Drive）裡，SA 是直接成員（不冒充任何人）。
 * Shared Drive 的檔案在 Drive API 預設查詢範圍之外，因此每個請求都要帶
 * supportsAllDrives=true；files.list 額外要帶 includeItemsFromAllDrives=true。
 */
import { getAccessToken } from './google-auth.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

// 幫路徑補上 supportsAllDrives=true（path 可能已有其他 query string）
function withSharedDriveSupport(path) {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}supportsAllDrives=true`;
}

async function driveRequest(env, path, options = {}) {
  const token = await getAccessToken(env);
  const res = await fetch(`${DRIVE_API}${withSharedDriveSupport(path)}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      ...options.headers
    }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive API error: ${res.status} ${err}`);
  }
  return res;
}

// List files in a folder
async function listFilesInFolder(env, folderId) {
  const query = `'${folderId}' in parents and trashed=false`;
  const res = await driveRequest(env,
    `/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=name&includeItemsFromAllDrives=true&corpora=allDrives`
  );
  const data = await res.json();
  return data.files || [];
}

// Read file content (handles Google Docs mimeType)
async function readFileContent(env, fileId) {
  // Check if file is a Google Doc (needs export instead of direct download)
  const metaRes = await driveRequest(env, `/files/${fileId}?fields=mimeType`);
  const metaData = await metaRes.json();
  if (metaData.mimeType === 'application/vnd.google-apps.document') {
    const res = await driveRequest(env, `/files/${fileId}/export?mimeType=text/plain`);
    return res.text();
  }
  const res = await driveRequest(env, `/files/${fileId}?alt=media`);
  return res.text();
}

// Get file metadata
async function getFileMetadata(env, fileId) {
  const res = await driveRequest(env, `/files/${fileId}?fields=id,name,mimeType,size,modifiedTime,webViewLink`);
  return res.json();
}

// === Skills ===

/**
 * List all skills from the skills/ folder
 * Each skill is a subfolder containing SKILL.md and optionally references/
 */
export async function listSkills(env) {
  const skillsFolderId = env.GOOGLE_DRIVE_SKILLS_FOLDER_ID;
  const folders = await listFilesInFolder(env, skillsFolderId);

  // Each skill is a folder
  const skills = [];
  for (const folder of folders) {
    if (folder.mimeType === 'application/vnd.google-apps.folder') {
      // List files in skill folder
      const files = await listFilesInFolder(env, folder.id);
      const skillMd = files.find(f => f.name === 'SKILL.md');

      // Parse description from first few lines of SKILL.md
      let description = '';
      if (skillMd) {
        try {
          const content = await readFileContent(env, skillMd.id);
          const descMatch = content.match(/description:\s*(.+)/);
          if (descMatch) description = descMatch[1].trim();
          else {
            // Get first meaningful line
            const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('---'));
            description = lines[0]?.substring(0, 100) || '';
          }
        } catch (e) {}
      }

      skills.push({
        id: folder.id,
        name: folder.name,
        description,
        fileCount: files.length,
        lastModified: folder.modifiedTime
      });
    }
  }

  return skills;
}

/**
 * Get full skill content (SKILL.md + all references)
 */
export async function getSkillDetail(env, skillFolderId) {
  const files = await listFilesInFolder(env, skillFolderId);
  const meta = await getFileMetadata(env, skillFolderId);

  const result = {
    name: meta.name,
    description: '',
    content: '',
    files: [],
    driveUrl: meta.webViewLink || ''
  };

  // Read SKILL.md
  const skillMd = files.find(f => f.name === 'SKILL.md');
  if (skillMd) {
    result.content = await readFileContent(env, skillMd.id);
    const descMatch = result.content.match(/description:\s*(.+)/);
    if (descMatch) result.description = descMatch[1].trim();
  }

  // List all files
  for (const f of files) {
    result.files.push({
      id: f.id,
      name: f.name,
      size: f.size,
      type: f.mimeType
    });

    // Check for references subfolder
    if (f.mimeType === 'application/vnd.google-apps.folder' && f.name === 'references') {
      const refs = await listFilesInFolder(env, f.id);
      for (const ref of refs) {
        result.files.push({
          id: ref.id,
          name: `references/${ref.name}`,
          size: ref.size,
          type: ref.mimeType
        });
      }
    }
  }

  return result;
}

/**
 * Load full skill content for generation (system_prompt + references)
 * Returns concatenated text to use as system prompt
 */
export async function loadSkillForGeneration(env, skillFolderId) {
  const files = await listFilesInFolder(env, skillFolderId);
  let systemPrompt = '';

  // 1. Read SKILL.md first
  const skillMd = files.find(f => f.name === 'SKILL.md');
  if (skillMd) {
    systemPrompt = await readFileContent(env, skillMd.id);
  }

  // 2. Read all reference files
  for (const f of files) {
    if (f.mimeType === 'application/vnd.google-apps.folder' && f.name === 'references') {
      const refs = await listFilesInFolder(env, f.id);
      for (const ref of refs) {
        if (ref.name.endsWith('.md') || ref.name.endsWith('.txt')) {
          const content = await readFileContent(env, ref.id);
          systemPrompt += `\n\n---\n## 參考資料：${ref.name}\n\n${content}`;
        }
      }
    }
  }

  return systemPrompt;
}

// === Memory ===

export async function listMemory(env) {
  const memoryFolderId = env.GOOGLE_DRIVE_MEMORY_FOLDER_ID;
  const files = await listFilesInFolder(env, memoryFolderId);
  return files
    .filter(f => f.name.endsWith('.md'))
    .map(f => ({
      id: f.id,
      name: f.name,
      lastModified: f.modifiedTime
    }));
}

export async function loadAllMemory(env) {
  const memoryFolderId = env.GOOGLE_DRIVE_MEMORY_FOLDER_ID;
  const files = await listFilesInFolder(env, memoryFolderId);
  let memoryContent = '';

  for (const f of files) {
    if (f.name.endsWith('.md')) {
      try {
        const content = await readFileContent(env, f.id);
        memoryContent += `\n\n## ${f.name}\n\n${content}`;
      } catch (e) {}
    }
  }

  return memoryContent;
}

// === Create Google Doc ===

/**
 * 將文案內容建立為 Google Docs 文件
 * @param {object} env - 環境變數
 * @param {string} title - 文件標題
 * @param {string} content - 文案內容（純文字或 markdown）
 * @param {string} folderId - 目標資料夾 ID
 * @returns {{ docUrl: string, docId: string }}
 */
export async function createGoogleDoc(env, title, content, folderId) {
  const token = await getAccessToken(env);

  // Convert markdown-style content to basic HTML for better formatting
  const htmlContent = markdownToHtml(content);

  // Metadata for the new file
  const metadata = {
    name: title,
    mimeType: 'application/vnd.google-apps.document',
    parents: [folderId]
  };

  // Use multipart upload: metadata + HTML content
  const boundary = '----FormBoundary' + Date.now();
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset=UTF-8\r\n\r\n` +
    `${htmlContent}\r\n` +
    `--${boundary}--`;

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`建立 Google Doc 失敗: ${res.status} ${err}`);
  }

  const file = await res.json();
  return {
    docId: file.id,
    docUrl: file.webViewLink || `https://docs.google.com/document/d/${file.id}/edit`
  };
}

/**
 * 上傳原始檔案到 Drive（不轉成 Google 格式，保留原副檔名與 mimeType）
 * 用於存配圖設計稿 .html，使用者可直接下載／用瀏覽器開啟
 * @returns {{ fileId: string, fileUrl: string, downloadUrl: string }}
 */
export async function uploadRawFile(env, name, content, mimeType, folderId) {
  const token = await getAccessToken(env);

  const metadata = { name, mimeType, parents: [folderId] };

  const boundary = '----FormBoundary' + Date.now();
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}; charset=UTF-8\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`上傳檔案失敗: ${res.status} ${err}`);
  }

  const file = await res.json();
  return {
    fileId: file.id,
    fileUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
    downloadUrl: `https://drive.google.com/uc?export=download&id=${file.id}`
  };
}

/**
 * 依資料夾名稱找出 skill 的 folder id（用於問卷系統直接定位 crowdfunding-survey）
 */
export async function getSkillFolderIdByName(env, name) {
  const skillsFolderId = env.GOOGLE_DRIVE_SKILLS_FOLDER_ID;
  const folders = await listFilesInFolder(env, skillsFolderId);
  const match = folders.find(
    f => f.mimeType === 'application/vnd.google-apps.folder' && f.name === name
  );
  return match ? match.id : null;
}

/**
 * 簡易 Markdown → HTML 轉換
 * 處理標題、粗體、列表、分隔線、段落
 */
function markdownToHtml(md) {
  if (!md) return '';

  let html = md
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    // Italic
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    // Horizontal rule
    .replace(/^---+$/gm, '<hr>')
    // Unordered list items
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    // Numbered list items
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Convert remaining line breaks to <br> (but not inside tags)
  const lines = html.split('\n');
  const result = [];
  for (const line of lines) {
    if (line.startsWith('<h') || line.startsWith('<ul') || line.startsWith('<hr') || line.startsWith('<li')) {
      result.push(line);
    } else if (line.trim() === '') {
      result.push('<br>');
    } else {
      result.push(`<p>${line}</p>`);
    }
  }

  return `<html><body style="font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.6;">
${result.join('\n')}
</body></html>`;
}
