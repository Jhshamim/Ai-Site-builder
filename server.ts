import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs/promises';
import path from 'path';
import { Octokit } from '@octokit/rest';

async function getFiles(dir: string, base: string = ''): Promise<any[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  let files: any[] = [];
  for (const entry of entries) {
    const relPath = path.join(base, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      files = files.concat(await getFiles(path.join(dir, entry.name), relPath));
    } else {
      files.push({ name: entry.name, path: relPath });
    }
  }
  return files;
}

let appInstance: any;

async function startServer() {
  const app = express();
  appInstance = app;
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Vercel only allows writing to /tmp in serverless functions
  const WORKSPACE_DIR = process.env.VERCEL 
    ? path.join('/tmp', 'workspace') 
    : path.resolve(process.cwd(), 'workspace');

  // Ensure workspace exists
  try {
    await fs.mkdir(WORKSPACE_DIR, { recursive: true });
  } catch (e) {}

  // Serve workspace files for the preview
  app.use('/preview', express.static(WORKSPACE_DIR));

  const resolvePath = (reqPath: string) => {
    const safePath = path.resolve(WORKSPACE_DIR, reqPath || '.');
    if (!safePath.startsWith(WORKSPACE_DIR)) {
      throw new Error("Access denied");
    }
    return safePath;
  };

  app.get('/api/fs/list', async (req, res) => {
    try {
      const dirPath = req.query.path as string || '.';
      const fullPath = resolvePath(dirPath);
      const files = await getFiles(fullPath);
      res.json({ files });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/fs/read', async (req, res) => {
    try {
      const filePath = req.query.path as string;
      const fullPath = resolvePath(filePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      res.json({ content });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/fs/write', async (req, res) => {
    try {
      const { path: filePath, content } = req.body;
      const fullPath = resolvePath(filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/fs/delete', async (req, res) => {
    try {
      const { path: filePath } = req.body;
      const fullPath = resolvePath(filePath);
      await fs.rm(fullPath, { recursive: true, force: true });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/github/sync', async (req, res) => {
    try {
      const { token, repoName, commitMessage } = req.body;
      if (!token) throw new Error("GitHub token is required");
      
      const octokit = new Octokit({ auth: token });
      const { data: user } = await octokit.users.getAuthenticated();
      const owner = user.login;

      let repo;
      try {
        const res = await octokit.repos.get({ owner, repo: repoName });
        repo = res.data;
      } catch (e: any) {
        if (e.status === 404) {
          const res = await octokit.repos.createForAuthenticatedUser({ name: repoName, auto_init: true });
          repo = res.data;
          await new Promise(r => setTimeout(r, 2000)); // Wait for init
        } else {
          throw e;
        }
      }

      const files = await getFiles(WORKSPACE_DIR);
      const tree = [];
      for (const file of files) {
        const content = await fs.readFile(path.join(WORKSPACE_DIR, file.path), 'utf-8');
        const { data: blob } = await octokit.git.createBlob({ owner, repo: repoName, content, encoding: 'utf-8' });
        tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
      }

      let baseTreeSha;
      let parentCommitSha;
      let refName = 'heads/main';

      try {
        const { data: ref } = await octokit.git.getRef({ owner, repo: repoName, ref: 'heads/main' }).catch(() => octokit.git.getRef({ owner, repo: repoName, ref: 'heads/master' }));
        refName = ref.ref.replace('refs/', '');
        parentCommitSha = ref.object.sha;
        const { data: commit } = await octokit.git.getCommit({ owner, repo: repoName, commit_sha: parentCommitSha });
        baseTreeSha = commit.tree.sha;
      } catch (e) {
        // Repo might be empty
      }

      const treeParams: any = { owner, repo: repoName, tree };
      if (baseTreeSha) treeParams.base_tree = baseTreeSha;
      const { data: newTree } = await octokit.git.createTree(treeParams);

      const commitParams: any = { owner, repo: repoName, message: commitMessage || 'Update from AI Builder', tree: newTree.sha };
      if (parentCommitSha) commitParams.parents = [parentCommitSha];
      const { data: newCommit } = await octokit.git.createCommit(commitParams);

      if (parentCommitSha) {
        await octokit.git.updateRef({ owner, repo: repoName, ref: refName, sha: newCommit.sha });
      } else {
        await octokit.git.createRef({ owner, repo: repoName, ref: 'refs/heads/main', sha: newCommit.sha });
      }

      res.json({ success: true, url: repo.html_url });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Vite middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api') && !req.path.startsWith('/preview')) {
        res.sendFile(path.join(distPath, 'index.html'));
      }
    });
  }

  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();

export default appInstance;
