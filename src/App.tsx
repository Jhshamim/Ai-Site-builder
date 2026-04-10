import { useState, useRef, useEffect } from 'react';
import { Send, Code, Play, Loader2, Sparkles, Terminal, Layout, FileCode, Folder, File as FileIcon, Save, RefreshCw, Bot, User, ChevronRight, ChevronDown, Trash2, Settings, Github, Globe, X, Download, Plus, MessageSquareX } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Octokit } from '@octokit/rest';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY });

const SYSTEM_INSTRUCTION = `You are an elite 10x AI Developer, my brother in code. You are a powerhouse IDE.
You have FULL access to a real file system in the '/workspace' directory.
You have GitHub integration to create repos and push code.
You have Google Search access to look up the latest docs and information.
When the user asks you to build something:
1. Think step-by-step. Use Google Search if you need to look up documentation.
2. Plan the file structure.
3. Use the write_file tool to create the necessary files.
4. If the user asks to push to GitHub, use the github_sync tool.
5. Always create an 'index.html' as the entry point.
Do not output code blocks of the files in your chat response. Just write them directly to the file system using your tools.`;

const tools = [{
  functionDeclarations: [
    {
      name: 'list_directory',
      description: 'List files and folders in a directory relative to the workspace root.',
      parameters: {
        type: Type.OBJECT,
        properties: { path: { type: Type.STRING, description: 'Directory path (e.g., "." for root)' } },
        required: ['path']
      }
    },
    {
      name: 'read_file',
      description: 'Read the contents of a file.',
      parameters: {
        type: Type.OBJECT,
        properties: { path: { type: Type.STRING, description: 'File path' } },
        required: ['path']
      }
    },
    {
      name: 'write_file',
      description: 'Write content to a file. Creates directories if they do not exist.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          path: { type: Type.STRING, description: 'File path' },
          content: { type: Type.STRING, description: 'File content' }
        },
        required: ['path', 'content']
      }
    },
    {
      name: 'delete_file',
      description: 'Delete a file or directory.',
      parameters: {
        type: Type.OBJECT,
        properties: { path: { type: Type.STRING, description: 'File path' } },
        required: ['path']
      }
    },
    {
      name: 'github_sync',
      description: 'Create a GitHub repository (if it does not exist) and push all workspace files to it.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          repoName: { type: Type.STRING, description: 'Name of the GitHub repository' },
          commitMessage: { type: Type.STRING, description: 'Commit message' }
        },
        required: ['repoName', 'commitMessage']
      }
    }
  ]
}, { googleSearch: {} }];

type Message = {
  role: 'user' | 'model';
  text: string;
  type?: 'text' | 'tool';
};

type VirtualFile = {
  path: string;
  content: string;
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', text: 'Hello! I am your personal coding AI. I have full file system access and no restrictions. What would you like to build today?', type: 'text' }
  ]);
  const [rawHistory, setRawHistory] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');
  
  const [vfs, setVfs] = useState<VirtualFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [githubToken, setGithubToken] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('github_token');
    if (token) setGithubToken(token);
    
    const savedMessages = localStorage.getItem('chat_messages');
    const savedHistory = localStorage.getItem('chat_history');
    const savedVfs = localStorage.getItem('vfs_files');
    if (savedMessages) setMessages(JSON.parse(savedMessages));
    if (savedHistory) setRawHistory(JSON.parse(savedHistory));
    if (savedVfs) setVfs(JSON.parse(savedVfs));
  }, []);

  useEffect(() => {
    if (messages.length > 1) {
      localStorage.setItem('chat_messages', JSON.stringify(messages));
      localStorage.setItem('chat_history', JSON.stringify(rawHistory));
    }
  }, [messages, rawHistory]);

  useEffect(() => {
    localStorage.setItem('vfs_files', JSON.stringify(vfs));
  }, [vfs]);

  const saveSettings = () => {
    localStorage.setItem('github_token', githubToken);
    setShowSettings(false);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleFileSelect = (path: string) => {
    setSelectedFile(path);
    setActiveTab('code');
    const file = vfs.find(f => f.path === path);
    setFileContent(file ? file.content : '');
  };

  const handleSaveFile = (contentToSave: string = fileContent) => {
    if (!selectedFile) return;
    setIsSaving(true);
    setVfs(prev => prev.map(f => f.path === selectedFile ? { ...f, content: contentToSave } : f));
    setTimeout(() => setIsSaving(false), 500);
  };

  const handleNewFile = () => {
    const fileName = prompt("Enter new file name (e.g., script.js):");
    if (fileName && !vfs.find(f => f.path === fileName)) {
      setVfs(prev => [...prev, { path: fileName, content: '' }]);
      handleFileSelect(fileName);
    }
  };

  const handleDeleteFile = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    if (confirm(`Are you sure you want to delete ${path}?`)) {
      setVfs(prev => prev.filter(f => f.path !== path));
      if (selectedFile === path) {
        setSelectedFile(null);
        setFileContent('');
      }
    }
  };

  const handleDownloadZip = async () => {
    try {
      const zip = new JSZip();
      for (const file of vfs) {
        zip.file(file.path, file.content);
      }
      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, 'ai-builder-project.zip');
    } catch (e) {
      console.error("Failed to download project", e);
      alert("Failed to download project. See console for details.");
    }
  };

  const handleClearChat = () => {
    if (confirm('Are you sure you want to clear the chat history?')) {
      setMessages([{ role: 'model', text: 'Hello! I am your personal coding AI. I have full file system access and no restrictions. What would you like to build today?', type: 'text' }]);
      setRawHistory([]);
      localStorage.removeItem('chat_messages');
      localStorage.removeItem('chat_history');
    }
  };

  const handleCodeChange = (code: string) => {
    setFileContent(code);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      handleSaveFile(code);
    }, 1000); // Auto-save after 1 second of typing
  };

  const generatePreviewHtml = () => {
    const indexFile = vfs.find(f => f.path === 'index.html' || f.path === './index.html');
    if (!indexFile) return '<div style="color:white;font-family:sans-serif;text-align:center;margin-top:20px;">No index.html found in workspace.</div>';

    let html = indexFile.content;

    const cssFiles = vfs.filter(f => f.path.endsWith('.css'));
    for (const css of cssFiles) {
      const regex = new RegExp(`<link[^>]*href=["']\\.?/?${css.path.replace('./', '')}["'][^>]*>`, 'gi');
      html = html.replace(regex, `<style>\n${css.content}\n</style>`);
    }

    const jsFiles = vfs.filter(f => f.path.endsWith('.js'));
    for (const js of jsFiles) {
      const regex = new RegExp(`<script[^>]*src=["']\\.?/?${js.path.replace('./', '')}["'][^>]*><\\/script>`, 'gi');
      html = html.replace(regex, `<script>\n${js.content}\n</script>`);
    }

    return html;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isGenerating) return;

    const userText = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userText, type: 'text' }]);
    setIsGenerating(true);

    try {
      let currentHistory = [...rawHistory];
      currentHistory.push({ role: 'user', parts: [{ text: userText }] });
      
      let isDone = false;
      while (!isDone) {
        const response = await ai.models.generateContent({
          model: 'gemini-3.1-pro-preview',
          contents: currentHistory,
          tools: tools,
          config: { systemInstruction: SYSTEM_INSTRUCTION }
        });

        const responseMessage = response.candidates?.[0]?.content;
        if (!responseMessage) break;
        
        currentHistory.push(responseMessage);

        if (response.functionCalls && response.functionCalls.length > 0) {
          const functionResponses = [];
          for (const call of response.functionCalls) {
            setMessages(prev => [...prev, { role: 'model', text: `Executing ${call.name}(${call.args.path})...`, type: 'tool' }]);
            
            let result;
            try {
              if (call.name === 'list_directory') {
                // Use functional state update to ensure we have the latest VFS
                let currentVfs: VirtualFile[] = [];
                setVfs(prev => { currentVfs = prev; return prev; });
                result = { files: currentVfs.map(f => ({ name: f.path, path: f.path })) };
              } else if (call.name === 'read_file') {
                let currentVfs: VirtualFile[] = [];
                setVfs(prev => { currentVfs = prev; return prev; });
                const file = currentVfs.find(f => f.path === call.args.path);
                result = file ? { content: file.content } : { error: "File not found" };
              } else if (call.name === 'write_file') {
                const path = call.args.path as string;
                const content = call.args.content as string;
                setVfs(prev => {
                  const existing = prev.find(f => f.path === path);
                  if (existing) {
                    return prev.map(f => f.path === path ? { ...f, content } : f);
                  }
                  return [...prev, { path, content }];
                });
                result = { success: true };
              } else if (call.name === 'delete_file') {
                const path = call.args.path as string;
                setVfs(prev => prev.filter(f => f.path !== path));
                if (selectedFile === path) {
                  setSelectedFile(null);
                  setFileContent('');
                }
                result = { success: true };
              } else if (call.name === 'github_sync') {
                if (!githubToken) {
                  result = { error: "User has not configured a GitHub token. Ask them to click the Settings icon and add it." };
                } else {
                  let currentVfs: VirtualFile[] = [];
                  setVfs(prev => { currentVfs = prev; return prev; });
                  
                  const octokit = new Octokit({ auth: githubToken });
                  const { data: user } = await octokit.users.getAuthenticated();
                  const owner = user.login;
                  const repoName = call.args.repoName as string;
                  const commitMessage = call.args.commitMessage as string || 'Update from AI Builder';

                  let repo;
                  try {
                    const res = await octokit.repos.get({ owner, repo: repoName });
                    repo = res.data;
                  } catch (e: any) {
                    if (e.status === 404) {
                      const res = await octokit.repos.createForAuthenticatedUser({ name: repoName, auto_init: true });
                      repo = res.data;
                      await new Promise(r => setTimeout(r, 2000));
                    } else throw e;
                  }

                  const tree = [];
                  for (const file of currentVfs) {
                    const { data: blob } = await octokit.git.createBlob({ owner, repo: repoName, content: file.content, encoding: 'utf-8' });
                    tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
                  }

                  let baseTreeSha, parentCommitSha, refName = 'heads/main';
                  try {
                    const { data: ref } = await octokit.git.getRef({ owner, repo: repoName, ref: 'heads/main' }).catch(() => octokit.git.getRef({ owner, repo: repoName, ref: 'heads/master' }));
                    refName = ref.ref.replace('refs/', '');
                    parentCommitSha = ref.object.sha;
                    const { data: commit } = await octokit.git.getCommit({ owner, repo: repoName, commit_sha: parentCommitSha });
                    baseTreeSha = commit.tree.sha;
                  } catch (e) {}

                  const treeParams: any = { owner, repo: repoName, tree };
                  if (baseTreeSha) treeParams.base_tree = baseTreeSha;
                  const { data: newTree } = await octokit.git.createTree(treeParams);

                  const commitParams: any = { owner, repo: repoName, message: commitMessage, tree: newTree.sha };
                  if (parentCommitSha) commitParams.parents = [parentCommitSha];
                  const { data: newCommit } = await octokit.git.createCommit(commitParams);

                  if (parentCommitSha) {
                    await octokit.git.updateRef({ owner, repo: repoName, ref: refName, sha: newCommit.sha });
                  } else {
                    await octokit.git.createRef({ owner, repo: repoName, ref: 'refs/heads/main', sha: newCommit.sha });
                  }

                  result = { success: true, url: repo.html_url };
                }
              }
            } catch (e: any) {
              result = { error: e.message };
            }
            
            functionResponses.push({
              name: call.name,
              response: result
            });
          }
          currentHistory.push({ role: 'user', parts: [{ functionResponse: functionResponses[0] }] });
        } else {
          isDone = true;
          const text = responseMessage.parts?.map(p => p.text).join('') || '';
          if (text) {
            setMessages(prev => [...prev, { role: 'model', text, type: 'text' }]);
          }
        }
      }
      setRawHistory(currentHistory);
    } catch (error) {
      console.error("Error generating content:", error);
      setMessages(prev => [...prev, { role: 'model', text: 'Sorry, an error occurred while generating the response.', type: 'text' }]);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#0E1117] text-gray-100 font-sans overflow-hidden">
      {/* Left Panel - Chat */}
      <div className="w-1/3 min-w-[350px] max-w-[450px] flex flex-col border-r border-gray-800 bg-[#0E1117]">
        <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-[#161B22]">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Sparkles className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h1 className="font-semibold text-gray-100">Unlimited AI Builder</h1>
              <p className="text-xs text-gray-400">Full File System Access</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={handleClearChat}
              title="Clear Chat"
              className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-red-400 transition-colors"
            >
              <MessageSquareX className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setShowSettings(true)}
              title="Settings"
              className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-gray-200 transition-colors"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
          {messages.map((msg, idx) => (
            <div key={idx} className={cn("flex gap-3", msg.role === 'user' ? "flex-row-reverse" : "")}>
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                msg.role === 'user' ? "bg-blue-600" : (msg.type === 'tool' ? "bg-gray-800" : "bg-gray-800 border border-gray-700")
              )}>
                {msg.role === 'user' ? <User className="w-5 h-5 text-white" /> : (msg.type === 'tool' ? <Wrench className="w-4 h-4 text-gray-400" /> : <Bot className="w-5 h-5 text-blue-400" />)}
              </div>
              <div className={cn(
                "max-w-[85%] rounded-2xl px-4 py-3",
                msg.role === 'user' 
                  ? "bg-blue-600 text-white rounded-tr-sm" 
                  : (msg.type === 'tool' ? "bg-transparent border border-gray-800 text-gray-400 text-xs font-mono py-2" : "bg-[#161B22] border border-gray-800 text-gray-200 rounded-tl-sm")
              )}>
                {msg.role === 'user' || msg.type === 'tool' ? (
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                ) : (
                  <div className="markdown-body text-sm prose prose-invert max-w-none">
                    <Markdown remarkPlugins={[remarkGfm]}>{msg.text}</Markdown>
                  </div>
                )}
              </div>
            </div>
          ))}
          {isGenerating && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center shrink-0">
                <Bot className="w-5 h-5 text-blue-400" />
              </div>
              <div className="bg-[#161B22] border border-gray-800 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                <span className="text-sm text-gray-400">Thinking...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-[#161B22] border-t border-gray-800">
          <form onSubmit={handleSubmit} className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe what you want to build..."
              disabled={isGenerating}
              className="w-full bg-[#0E1117] border border-gray-700 rounded-xl py-3 pl-4 pr-12 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 transition-all"
            />
            <button
              type="submit"
              disabled={!input.trim() || isGenerating}
              className="absolute right-2 p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>

      {/* Middle Panel - File Explorer */}
      <div className="w-64 flex flex-col border-r border-gray-800 bg-[#0E1117]">
        <div className="flex items-center justify-between p-3 border-b border-gray-800 bg-[#161B22]">
          <span className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Explorer</span>
          <div className="flex items-center gap-1">
            <button onClick={handleNewFile} title="New File" className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-gray-200">
              <Plus className="w-4 h-4" />
            </button>
            <button onClick={handleDownloadZip} title="Download Project as ZIP" className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-gray-200">
              <Download className="w-4 h-4" />
            </button>
            <button onClick={() => setVfs([])} title="Clear Workspace" className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-red-400">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
          {vfs.map((file, idx) => (
            <div 
              key={idx} 
              onClick={() => handleFileSelect(file.path)}
              className={cn(
                "flex items-center justify-between px-2 py-1.5 rounded cursor-pointer text-sm transition-colors group",
                selectedFile === file.path ? "bg-blue-600/20 text-blue-400" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              )}
            >
              <div className="flex items-center gap-2 truncate">
                <FileIcon className="w-4 h-4 shrink-0" />
                <span className="truncate">{file.path}</span>
              </div>
              <button 
                onClick={(e) => handleDeleteFile(e, file.path)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 text-gray-500 hover:text-red-400 rounded transition-all"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          {vfs.length === 0 && (
            <div className="text-xs text-gray-500 p-2 text-center mt-4">
              Workspace is empty. Ask the AI to create files!
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Preview/Code */}
      <div className="flex-1 flex flex-col bg-[#0E1117]">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-[#161B22]">
          <div className="flex gap-1 bg-[#0E1117] p-1 rounded-lg border border-gray-800">
            <button
              onClick={() => setActiveTab('preview')}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                activeTab === 'preview' ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-200"
              )}
            >
              <Play className="w-4 h-4" />
              Preview
            </button>
            <button
              onClick={() => setActiveTab('code')}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                activeTab === 'code' ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-200"
              )}
            >
              <Code className="w-4 h-4" />
              Code
            </button>
          </div>
          
          {activeTab === 'code' && selectedFile && (
            <div className="flex items-center gap-2">
              {isSaving && <span className="text-xs text-gray-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Auto-saving...</span>}
              <button
                onClick={() => handleSaveFile(fileContent)}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Save className="w-4 h-4" />
                Save
              </button>
            </div>
          )}

          {activeTab === 'preview' && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 text-green-400 rounded-lg border border-green-500/20 text-xs font-medium">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Live
            </div>
          )}
        </div>

        <div className="flex-1 relative overflow-hidden bg-white">
          {activeTab === 'preview' ? (
            <iframe
              srcDoc={generatePreviewHtml()}
              title="Preview"
              className="w-full h-full border-0 bg-white"
              sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"
            />
          ) : (
            <div className="w-full h-full bg-[#0E1117] flex flex-col">
              {selectedFile ? (
                <div className="flex-1 overflow-auto custom-scrollbar">
                  <Editor
                    value={fileContent}
                    onValueChange={handleCodeChange}
                    highlight={code => Prism.highlight(code, Prism.languages.javascript, 'javascript')}
                    padding={16}
                    style={{
                      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                      fontSize: 14,
                      backgroundColor: 'transparent',
                      minHeight: '100%',
                      color: '#e2e8f0'
                    }}
                    className="focus:outline-none"
                  />
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-gray-500">
                  <FileCode className="w-12 h-12 mb-4 opacity-20" />
                  <p>Select a file from the explorer to view or edit</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#161B22] border border-gray-800 rounded-xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Settings className="w-5 h-5 text-blue-400" />
                Settings
              </h2>
              <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1 flex items-center gap-2">
                  <Github className="w-4 h-4" />
                  GitHub Personal Access Token
                </label>
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="ghp_..."
                  className="w-full bg-[#0E1117] border border-gray-700 rounded-lg py-2 px-3 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Required for the AI to create repositories and push code. Needs 'repo' scope.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={saveSettings}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

