/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, type FormEvent, useMemo, useCallback, useRef } from 'react';
import { Trash2, CheckCircle2, Search, Filter, Sparkles, Calendar, Tag, BarChart2, Timer, Play, Pause, RotateCcw, AlarmClock, Bell, X, Check, Settings, Volume2, Upload } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";

type Priority = 'low' | 'medium' | 'high';

interface Task {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
  priority: Priority;
  category: string;
  dueDate?: string;
  timerSeconds?: number;
  timerOriginal?: number;
  isTimerRunning?: boolean;
  reminderAt?: number;
}

const CATEGORIES = ['General', 'Work', 'Personal', 'Shopping', 'Health', 'Finance'];
const PRIORITIES: Priority[] = ['low', 'medium', 'high'];
const TIMER_PRESETS = [
  { label: 'Off', value: 0 },
  { label: '5m', value: 300 },
  { label: '10m', value: 600 },
  { label: '25m', value: 1500 },
  { label: '50m', value: 3000 },
];

const REMINDER_PRESETS = [
  { label: 'None', value: 0 },
  { label: '2 min', value: 120000 },
  { label: '5 min', value: 300000 },
  { label: '10 min', value: 600000 },
  { label: '30 min', value: 1800000 },
  { label: '1 hr', value: 3600000 },
];

const DEFAULT_NOTIFICATION_SOUND = "https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'info' | 'reminder';
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(() => {
    const saved = localStorage.getItem('zendo-tasks-v3');
    if (!saved) {
      const old = localStorage.getItem('zendo-tasks-v2');
      if (old) {
        return JSON.parse(old);
      }
      return [];
    }
    return JSON.parse(saved);
  });
  
  const [inputValue, setInputValue] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [category, setCategory] = useState('General');
  const [dueDate, setDueDate] = useState('');
  const [selectedTimer, setSelectedTimer] = useState(0);
  const [selectedReminder, setSelectedReminder] = useState(0);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed'>('all');
  const [filterCategory, setFilterCategory] = useState('all');
  
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [customSound, setCustomSound] = useState<string | null>(() => localStorage.getItem('zendo-sound'));

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playNotificationSound = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(customSound || DEFAULT_NOTIFICATION_SOUND);
    } else {
      audioRef.current.src = customSound || DEFAULT_NOTIFICATION_SOUND;
    }
    audioRef.current.play().catch(e => console.error("Audio Play Error:", e));
  }, [customSound]);

  const addToast = useCallback((message: string, type: 'success' | 'info' | 'reminder' = 'success') => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  const sendBrowserNotification = useCallback((title: string, body: string) => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(title, { body, icon: '/favicon.ico' });
      } catch (e) {
        console.error("Notification Error:", e);
      }
    }
  }, []);

  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') {
      addToast('System notifications not supported on this device.', 'info');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setNotificationsEnabled(permission === 'granted');
      if (permission === 'granted') {
        addToast('System notifications enabled!', 'info');
      }
    } catch (e) {
      console.error("Permission Request Error:", e);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationsEnabled(Notification.permission === 'granted');
    }
  }, []);

  // Main interval for timers and reminders
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setTasks(prev => prev.map(task => {
        let updated = { ...task };
        let changed = false;

        // Check Timer
        if (task.isTimerRunning && task.timerSeconds !== undefined && task.timerSeconds > 0) {
          const newSeconds = task.timerSeconds - 1;
          if (newSeconds === 0) {
            setTimeout(() => {
              addToast(`Timer Finished: ${task.text}`, 'info');
              sendBrowserNotification('Timer Finished', `Time's up for: ${task.text}`);
              playNotificationSound();
            }, 0);
            updated.timerSeconds = 0;
            updated.isTimerRunning = false;
            changed = true;
          } else {
            updated.timerSeconds = newSeconds;
            changed = true;
          }
        }

        // Check Reminder
        if (task.reminderAt && now >= task.reminderAt && !task.completed) {
          setTimeout(() => {
            addToast(`Reminder: ${task.text}`, 'reminder');
            sendBrowserNotification('Task Double Check', `Don't forget: ${task.text}`);
            playNotificationSound();
          }, 0);
          updated.reminderAt = undefined; // Trigger once
          changed = true;
        }

        return changed ? updated : task;
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, [addToast, sendBrowserNotification, playNotificationSound]);

  useEffect(() => {
    localStorage.setItem('zendo-tasks-v3', JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    if (customSound) {
      localStorage.setItem('zendo-sound', customSound);
    }
  }, [customSound]);

  const handleSoundUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setCustomSound(result);
        addToast('Custom notification sound updated!', 'info');
      };
      reader.readAsDataURL(file);
    }
  };

  const addTask = (e?: FormEvent) => {
    e?.preventDefault();
    if (!inputValue.trim()) return;

    const newTask: Task = {
      id: crypto.randomUUID(),
      text: inputValue.trim(),
      completed: false,
      createdAt: Date.now(),
      priority,
      category,
      dueDate: dueDate || undefined,
      timerSeconds: selectedTimer > 0 ? selectedTimer : undefined,
      timerOriginal: selectedTimer > 0 ? selectedTimer : undefined,
      isTimerRunning: false,
      reminderAt: selectedReminder > 0 ? Date.now() + selectedReminder : undefined,
    };

    setTasks([newTask, ...tasks]);
    setInputValue('');
    setPriority('medium');
    setCategory('General');
    setDueDate('');
    setSelectedTimer(0);
    setSelectedReminder(0);
  };

  const toggleTask = (id: string) => {
    setTasks(tasks.map(task => {
      if (task.id === id) {
        const newCompleted = !task.completed;
        if (newCompleted) {
          addToast(`Completed: ${task.text}`);
          sendBrowserNotification('Task Completed', `You finished: ${task.text}`);
        }
        return { ...task, completed: newCompleted, isTimerRunning: false, reminderAt: undefined };
      }
      return task;
    }));
  };

  const toggleTimer = (id: string) => {
    setTasks(tasks.map(task => 
      task.id === id ? { ...task, isTimerRunning: !task.isTimerRunning } : task
    ));
  };

  const resetTimer = (id: string) => {
    setTasks(tasks.map(task => 
      task.id === id ? { ...task, timerSeconds: task.timerOriginal, isTimerRunning: false } : task
    ));
  };

  const deleteTask = (id: string) => {
    setTasks(tasks.filter(task => task.id !== id));
  };

  const clearAll = () => {
    if (window.confirm('Clear all tasks?')) {
      setTasks([]);
    }
  };

  const suggestEnhancement = async () => {
    if (!inputValue.trim() || isAiLoading) return;
    setIsAiLoading(true);
    
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Given this task description: "${inputValue}", suggest a professional version of the task, its priority (low, medium, high), and a category from [${CATEGORIES.join(', ')}].`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              improvedTask: { type: Type.STRING },
              suggestedPriority: { type: Type.STRING, enum: PRIORITIES },
              suggestedCategory: { type: Type.STRING, enum: CATEGORIES },
            },
            required: ["improvedTask", "suggestedPriority", "suggestedCategory"]
          }
        }
      });

      const data = JSON.parse(response.text);
      setInputValue(data.improvedTask);
      setPriority(data.suggestedPriority as Priority);
      setCategory(data.suggestedCategory);
    } catch (error) {
      console.error("AI Error:", error);
    } finally {
      setIsAiLoading(false);
    }
  };

  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      const matchesSearch = task.text.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = filterStatus === 'all' || (filterStatus === 'completed' ? task.completed : !task.completed);
      const matchesCategory = filterCategory === 'all' || task.category === filterCategory;
      return matchesSearch && matchesStatus && matchesCategory;
    });
  }, [tasks, searchQuery, filterStatus, filterCategory]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    const highPriority = tasks.filter(t => t.priority === 'high' && !t.completed).length;
    return { total, completed, highPriority };
  }, [tasks]);

  const activeTasks = tasks.filter(t => !t.completed).length;

  const formattedDate = new Intl.DateTimeFormat('en-US', { 
    weekday: 'long', 
    month: 'short', 
    day: 'numeric' 
  }).format(new Date());

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-[500px] sm:h-[800px] rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.08)] flex flex-col relative overflow-hidden transition-all border border-app-divider">
        <header className="px-8 pt-10 pb-6 flex-shrink-0 flex justify-between items-start">
          <div>
            <div className="text-[13px] text-app-secondary uppercase tracking-[1px] font-semibold mb-1">
              {formattedDate}
            </div>
            <h1 className="text-[28px] font-bold tracking-[-0.5px] text-app-ink">ZenDo Pro</h1>
          </div>
          <div className="flex gap-2">
            {!notificationsEnabled && 'Notification' in window && (
              <button 
                onClick={requestNotificationPermission}
                className="p-2 rounded-xl bg-app-bg text-app-secondary hover:text-app-accent transition-all cursor-pointer"
                title="Enable browser notifications"
              >
                <Bell className="w-5 h-5" />
              </button>
            )}
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-xl bg-app-bg text-app-secondary hover:text-app-ink transition-all cursor-pointer"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setShowStats(!showStats)}
              className={`p-2 rounded-xl transition-all cursor-pointer ${showStats ? 'bg-app-accent text-white' : 'bg-app-bg text-app-secondary hover:text-app-ink'}`}
            >
              <BarChart2 className="w-5 h-5" />
            </button>
          </div>
        </header>

        {showStats && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            className="px-8 pb-6 overflow-hidden"
          >
            <div className="grid grid-cols-3 gap-3 bg-app-bg p-4 rounded-2xl">
              <div className="text-center">
                <div className="text-xs text-app-secondary font-bold uppercase mb-1">Total</div>
                <div className="text-xl font-bold">{stats.total}</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-app-secondary font-bold uppercase mb-1">Done</div>
                <div className="text-xl font-bold text-emerald-600">{stats.completed}</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-app-secondary font-bold uppercase mb-1">Urgent</div>
                <div className="text-xl font-bold text-rose-500">{stats.highPriority}</div>
              </div>
            </div>
          </motion.div>
        )}

        <section className="px-8 pb-4 flex-shrink-0 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-app-muted" />
            <input 
              type="text"
              placeholder="Quick search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-app-bg border border-app-border rounded-xl py-2 pl-9 pr-4 text-sm outline-none focus:border-app-accent"
            />
          </div>

          <form onSubmit={addTask} className="space-y-3" id="task-form">
            <div className="relative">
              <input
                id="task-input"
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="What needs to be done?"
                className="w-full bg-[#F7F8F9] border border-app-border rounded-xl py-3.5 px-4 text-[15px] outline-none focus:border-app-accent transition-colors placeholder:text-app-muted pr-20"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={suggestEnhancement}
                  disabled={!inputValue.trim() || isAiLoading}
                  className="p-1.5 text-app-accent hover:bg-app-accent/10 rounded-lg transition-all disabled:opacity-30 disabled:grayscale cursor-pointer"
                  title="AI Magic Suggest"
                >
                  <Sparkles className={`w-5 h-5 ${isAiLoading ? 'animate-pulse text-app-accent' : 'text-app-muted'}`} />
                </button>
                <button
                  id="add-task-btn"
                  type="submit"
                  className="bg-app-accent text-white rounded-lg w-8 h-8 flex items-center justify-center cursor-pointer font-bold text-lg hover:brightness-110 transition-all disabled:opacity-30"
                  disabled={!inputValue.trim()}
                >
                  +
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-1.5 bg-app-bg px-2 py-1 rounded-lg border border-app-border">
                <Tag className="w-3 h-3 text-app-secondary" />
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="text-[11px] font-bold uppercase tracking-wider bg-transparent outline-none">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="flex items-center gap-1.5 bg-app-bg px-2 py-1 rounded-lg border border-app-border">
                <div className={`w-1.5 h-1.5 rounded-full ${priority === 'high' ? 'bg-rose-500' : priority === 'medium' ? 'bg-amber-500' : 'bg-slate-400'}`} />
                <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="text-[11px] font-bold uppercase tracking-wider bg-transparent outline-none capitalize">
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div className="flex items-center gap-1.5 bg-app-bg px-2 py-1 rounded-lg border border-app-border">
                <Timer className="w-3 h-3 text-app-secondary" />
                <select value={selectedTimer} onChange={(e) => setSelectedTimer(Number(e.target.value))} className="text-[11px] font-bold uppercase tracking-wider bg-transparent outline-none">
                  <option value={0}>No Timer</option>
                  {TIMER_PRESETS.filter(p => p.value > 0).map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>

              <div className="flex items-center gap-1.5 bg-app-bg px-2 py-1 rounded-lg border border-app-border">
                <AlarmClock className="w-3 h-3 text-app-secondary" />
                <select value={selectedReminder} onChange={(e) => setSelectedReminder(Number(e.target.value))} className="text-[11px] font-bold uppercase tracking-wider bg-transparent outline-none">
                  {REMINDER_PRESETS.map(p => <option key={p.value} value={p.value}>Remind: {p.label}</option>)}
                </select>
              </div>
            </div>
          </form>
        </section>

        <div className="px-8 pb-4 flex items-center gap-2 overflow-x-auto scrollbar-hide flex-shrink-0">
          <Filter className="w-4 h-4 text-app-secondary flex-shrink-0" />
          <div className="flex gap-1.5">
            {['all', 'active', 'completed'].map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s as any)}
                className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer ${
                  filterStatus === s ? 'bg-app-ink text-white' : 'bg-app-divider text-app-secondary'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="w-px h-4 bg-app-divider mx-1 flex-shrink-0" />
          <select 
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="bg-app-divider text-app-secondary text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-full outline-none cursor-pointer"
          >
            <option value="all">Any Category</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="flex-grow px-8 overflow-y-auto scrollbar-hide pb-8">
          <AnimatePresence initial={false}>
            {filteredTasks.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="py-12 text-center text-app-secondary"
                id="empty-state"
              >
                <p className="text-sm font-medium">No tasks found matching your filters.</p>
              </motion.div>
            ) : (
              <div className="divide-y divide-app-divider">
                {filteredTasks.map((task) => (
                  <motion.div
                    key={task.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="flex items-start gap-4 py-4 group"
                    id={`task-${task.id}`}
                  >
                    <button
                      id={`toggle-${task.id}`}
                      onClick={() => toggleTask(task.id)}
                      className={`mt-0.5 flex-shrink-0 w-[22px] h-[22px] border-2 rounded-md flex items-center justify-center transition-all cursor-pointer ${
                        task.completed 
                          ? 'bg-app-accent border-app-accent' 
                          : 'border-[#DCDFE4] hover:border-app-accent'
                      }`}
                    >
                      {task.completed && (
                        <div className="text-white text-[14px] mb-0.5">✓</div>
                      )}
                    </button>
                    
                    <div className="flex-grow min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span 
                          className={`text-[15px] font-medium transition-all ${
                            task.completed ? 'line-through text-app-muted' : 'text-app-ink'
                          }`}
                        >
                          {task.text}
                        </span>
                        {task.priority === 'high' && !task.completed && (
                          <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                        )}
                        {task.priority === 'medium' && !task.completed && (
                          <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500" />
                        )}
                        {task.reminderAt && !task.completed && (
                          <Bell className="w-3 h-3 text-app-accent animate-bounce" />
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] font-bold text-app-secondary uppercase tracking-wider">
                        <span className="flex items-center gap-1">
                          <Tag className="w-3 h-3" /> {task.category}
                        </span>
                        {task.dueDate && (
                          <span className={`${new Date(task.dueDate) < new Date() && !task.completed ? 'text-rose-500' : 'text-app-accent'} flex items-center gap-1`}>
                            <Calendar className="w-3 h-3" /> {task.dueDate}
                          </span>
                        )}
                      </div>
                      
                      {task.timerSeconds !== undefined && !task.completed && (
                        <div className="mt-2 flex items-center gap-3 bg-app-bg px-3 py-1.5 rounded-xl border border-app-divider w-fit">
                          <AlarmClock className={`w-3.5 h-3.5 ${task.isTimerRunning ? 'text-app-accent animate-pulse' : 'text-app-secondary'}`} />
                          <span className={`text-sm font-mono font-bold ${task.timerSeconds === 0 ? 'text-rose-500' : 'text-app-ink'}`}>
                            {formatTime(task.timerSeconds)}
                          </span>
                          <div className="flex items-center gap-2 ml-1">
                            <button 
                              onClick={() => toggleTimer(task.id)}
                              className="p-1 hover:bg-app-divider rounded-md transition-colors text-app-secondary hover:text-app-ink cursor-pointer"
                            >
                              {task.isTimerRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                            </button>
                            <button 
                              onClick={() => resetTimer(task.id)}
                              className="p-1 hover:bg-app-divider rounded-md transition-colors text-app-secondary hover:text-app-ink cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      id={`delete-${task.id}`}
                      onClick={() => deleteTask(task.id)}
                      className="flex-shrink-0 text-[#C1C9D2] hover:text-rose-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </motion.div>
                ))}
              </div>
            )}
          </AnimatePresence>
        </div>

        <footer className="px-8 py-6 border-t border-app-divider flex justify-between items-center flex-shrink-0 bg-white z-10">
          <span className="text-[13px] text-app-secondary font-medium">
            {activeTasks} {activeTasks === 1 ? 'task' : 'tasks'} left
          </span>
          {tasks.length > 0 && (
            <button 
              onClick={clearAll}
              className="text-[13px] text-app-accent font-semibold cursor-pointer hover:underline"
            >
              Reset List
            </button>
          )}
        </footer>

        <AnimatePresence>
          {showSettings && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-white/95 z-[200] p-8 flex flex-col"
            >
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-bold text-app-ink">Settings</h2>
                <button onClick={() => setShowSettings(false)} className="p-2 bg-app-bg rounded-xl hover:text-rose-500 transition-colors cursor-pointer">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-app-secondary mb-3 block">Notification Sound</label>
                  <div className="bg-app-bg p-4 rounded-2xl border border-app-border">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <Volume2 className="w-5 h-5 text-app-accent" />
                        <span className="text-sm font-medium text-app-ink">
                          {customSound ? "Custom sound loaded ✓" : "Default system sound"}
                        </span>
                      </div>
                      <button 
                        onClick={playNotificationSound}
                        className="px-4 py-1.5 flex items-center gap-2 bg-app-bg hover:bg-app-divider rounded-lg text-xs font-bold transition-colors cursor-pointer"
                      >
                        <Play className="w-3 h-3" /> Test
                      </button>
                    </div>
                    
                    <label className="w-full flex items-center justify-center gap-3 py-3 border-2 border-dashed border-app-border rounded-xl hover:border-app-accent cursor-pointer transition-colors">
                      <Upload className="w-4 h-4 text-app-secondary" />
                      <span className="text-sm font-semibold text-app-secondary">Upload Custom MP3</span>
                      <input type="file" accept="audio/*" onChange={handleSoundUpload} className="hidden" />
                    </label>
                  </div>
                </div>

                <div className="pt-4">
                  <button 
                    onClick={() => {
                      localStorage.removeItem('zendo-sound');
                      setCustomSound(null);
                      addToast('Reset to default sound', 'info');
                    }}
                    className="text-xs text-rose-500 font-bold hover:underline cursor-pointer"
                  >
                    Reset to Default Sound
                  </button>
                </div>
              </div>

              <div className="mt-auto py-4 text-center">
                <p className="text-[11px] text-app-secondary font-medium uppercase tracking-[2px]">ZenDo Pro Edition</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Toast Container */}
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[100] w-full max-w-[320px] pointer-events-none px-4 flex flex-col gap-2">
          <AnimatePresence>
            {toasts.map(toast => (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl border ${
                  toast.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 
                  toast.type === 'reminder' ? 'bg-rose-50 border-rose-100 text-rose-800' :
                  'bg-indigo-50 border-indigo-100 text-indigo-800'
                }`}
              >
                {toast.type === 'success' ? <Check className="w-4 h-4 flex-shrink-0" /> : 
                 toast.type === 'reminder' ? <AlarmClock className="w-4 h-4 flex-shrink-0 animate-bounce" /> :
                 <Bell className="w-4 h-4 flex-shrink-0" />}
                <span className="text-xs font-bold leading-tight flex-grow">{toast.message}</span>
                <button 
                  onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
                  className="hover:bg-black/5 p-0.5 rounded transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
