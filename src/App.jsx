import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Plus, Check, Calendar, Trash2, Bell, Sparkles, ShoppingBag, ArrowRightLeft, Wifi, X, Info, Cloud } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, addDays, differenceInDays } from 'date-fns';
import { ja } from 'date-fns/locale';

// Styles
import 'swiper/css';
import './index.css';

import { supabase } from './supabaseClient';

const CATEGORIES = ['食品', 'すべて', '美穂', 'その他', '生活用品', 'おそうじ', '子供', '100均', '明則'];
const NON_CYCLIC_CATEGORIES = ['食品'];

const EMOJI_MAP = {
  '鶏肉': '🍗', 'とり': '🐣', '肉': '🥩', '豚': '🐷', '牛': '🐮', '挽肉': '🥡',
  '牛乳': '🥛', 'ミルク': '🐄', '卵': '🥚', 'たまご': '🍳', 'パン': '🍞', '食パン': '🍞',
  '米': '🌾', 'ごはん': '🍚', '野菜': '🥕', 'キャベツ': '🥬', '玉ねぎ': '🧅', '人参': '🥕', 'じゃがいも': '🥔',
  '魚': '🐟', '刺身': '🍣', '鮭': '🍣',
  '水': '💧', 'お茶': '🍵', 'コーヒー': '☕', '酒': '🍺', 'ビール': '🍺', 'ワイン': '🍷',
  '洗剤': '🧼', '石鹸': '🧼', 'ハンドソープ': '🧼', 'シャンプー': '🧴', 'リンス': '🧴',
  'トイレットペーパー': '🧻', 'ティッシュ': '🤧', 'ペーパー': '📄',
  'タオル': '🧤', 'スポンジ': '🧽', 'ゴミ袋': '🗑️', 'クイックル': '🧹', '掃除': '🧹',
  'おむつ': '👶', 'ベビー': '👶', '子供': '🖍️',
  '100均': '🪙', '電池': '🔋', '文房具': '✏️',
  '調味料': '🧂', '醤油': '🍾', '味噌': '🍲', '油': '🌻', '砂糖': '🍭', '塩': '🧂'
};

const EXCLUDE_KEYWORDS = ['生理', 'ナプキン', 'タンポン'];

const predictEmoji = (name) => {
  if (!name) return '';
  if (EXCLUDE_KEYWORDS.some(k => name.includes(k))) return '';
  for (const [key, value] of Object.entries(EMOJI_MAP)) {
    if (name.includes(key)) return value;
  }
  return '';
};

const App = () => {
  const [items, setItems] = useState([]);
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState(CATEGORIES[1]);
  const [swiper, setSwiper] = useState(null);
  const [movingItemId, setMovingItemId] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const longPressTimer = useRef(null);

  const fetchItems = async () => {
    setIsSyncing(true);
    try {
      const { data, error } = await supabase
        .from('items')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (data) setItems(data);
    } catch (err) {
      console.error('Supabase fetch error:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    fetchItems();

    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, () => {
        fetchItems();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const itemsWithPrediction = useMemo(() => {
    return items.map(item => {
      if (NON_CYCLIC_CATEGORIES.includes(item.category)) {
        return { ...item, nextDate: null, daysUntil: Infinity, isNear: false, isNonCyclic: true };
      }
      let nextDate = null;
      let daysUntil = Infinity;
      let isNear = false;
      if (item.lastPurchased && item.intervals && item.intervals.length > 0) {
        const avgInterval = item.intervals.reduce((a, b) => a + b, 0) / item.intervals.length;
        nextDate = addDays(new Date(item.lastPurchased), avgInterval);
        daysUntil = differenceInDays(nextDate, new Date());
        isNear = daysUntil <= 3 && !item.isOut;
      }
      return { ...item, nextDate, daysUntil, isNear, isNonCyclic: false };
    });
  }, [items]);

  const handleToggleOut = async (id) => {
    const item = items.find(i => i.id === id);
    if (!item) return;

    const isChecking = !item.isOut;
    let updates = { isOut: isChecking };

    if (!isChecking) {
      const now = new Date();
      const last = new Date(item.lastPurchased);
      const interval = differenceInDays(now, last);
      const isNonCyclic = NON_CYCLIC_CATEGORIES.includes(item.category);
      const newIntervals = (!isNonCyclic && interval > 0)
        ? [...(item.intervals || []), interval].slice(-5)
        : (item.intervals || []);

      updates = {
        ...updates,
        lastPurchased: now.toISOString(),
        intervals: newIntervals
      };
    }

    try {
      const { error } = await supabase
        .from('items')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Update error:', err);
    }
  };

  const addItem = async () => {
    if (!newItemName.trim()) return;
    const newItem = {
      name: newItemName,
      category: newItemCategory,
      lastPurchased: new Date().toISOString(),
      intervals: [],
      isOut: true,
      emoji: predictEmoji(newItemName)
    };

    try {
      const { error } = await supabase
        .from('items')
        .insert([newItem]);
      if (error) throw error;
      setNewItemName('');
      setIsModalOpen(false);
    } catch (err) {
      console.error('Add error:', err);
    }
  };

  const deleteItem = async (id) => {
    try {
      const { error } = await supabase
        .from('items')
        .delete()
        .eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const moveItem = async (id, newCat) => {
    try {
      const { error } = await supabase
        .from('items')
        .update({ category: newCat })
        .eq('id', id);
      if (error) throw error;
      setMovingItemId(null);
    } catch (err) {
      console.error('Move error:', err);
    }
  };

  const handleTouchStart = (id) => {
    longPressTimer.current = setTimeout(() => {
      setMovingItemId(id);
    }, 600);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  };

  const getFilteredItems = (cat) => {
    if (cat === 'すべて') {
      return [...itemsWithPrediction]
        .filter(item => !NON_CYCLIC_CATEGORIES.includes(item.category))
        .sort((a, b) => {
          if (a.isOut && !b.isOut) return -1;
          if (!a.isOut && b.isOut) return 1;
          return a.daysUntil - b.daysUntil;
        });
    }
    return itemsWithPrediction.filter(item => item.category === cat);
  };

  return (
    <div className="app-container" onContextMenu={e => e.preventDefault()}>
      <header className="header" style={{ overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)' }}>
          <div className={`sync-dot ${isSyncing ? 'animating' : ''}`} title="同期中" />
        </div>
        <motion.h1
          animate={{ x: [0, 8, -8, 4, -4, 0], y: [0, -4, 4, -2, 2, 0], rotate: [0, 1.5, -1.5, 0.5, -0.5, 0] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        >
          ✨ みぽりの買い物リスト ✨
        </motion.h1>
        <button
          onClick={() => setIsInfoOpen(true)}
          style={{ position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer' }}
        >
          <Cloud size={24} />
        </button>
      </header>

      <div className="tabs-container">
        <div className="swiper-pagination-custom">
          {CATEGORIES.map((cat, idx) => (
            <div key={cat} className={`tab-item ${activeCategory === cat ? 'active' : ''}`} onClick={() => { setActiveCategory(cat); swiper?.slideTo(idx); }}>
              {cat}
            </div>
          ))}
        </div>
      </div>

      <Swiper onSwiper={setSwiper} onSlideChange={(s) => setActiveCategory(CATEGORIES[s.activeIndex])} style={{ flex: 1, width: '100%' }}>
        {CATEGORIES.map(cat => (
          <SwiperSlide key={cat}>
            <div className="item-list">
              <AnimatePresence mode="popLayout">
                {getFilteredItems(cat).map(item => (
                  <div key={item.id} style={{ position: 'relative' }}>
                    <motion.div
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="item-card"
                      onMouseDown={() => handleTouchStart(item.id)}
                      onMouseUp={handleTouchEnd}
                      onTouchStart={() => handleTouchStart(item.id)}
                      onTouchEnd={handleTouchEnd}
                    >
                      <div className={`checkbox-wrapper ${item.isOut ? '' : 'checked'}`} onClick={() => handleToggleOut(item.id)}>
                        {!item.isOut && <Check size={18} color="white" />}
                      </div>
                      <div className="item-info" onClick={() => handleToggleOut(item.id)}>
                        <span className="item-category-label">{item.category}</span>
                        <div className="item-name" style={{ textDecoration: !item.isOut ? 'line-through' : 'none', opacity: !item.isOut ? 0.5 : 1 }}>
                          <span style={{ fontSize: '1.2rem', marginRight: 8 }}>{item.emoji}</span> {item.name}
                        </div>
                        <div className="item-meta">
                          {!item.isNonCyclic && (
                            <>
                              <Calendar size={12} />
                              {item.lastPurchased && item.nextDate ? `予定: ${format(item.nextDate, 'M/d')}` : '学習中...'}
                              {item.isNear && <span className="remind-badge pulse"><Bell size={10} /> そろそろ</span>}
                            </>
                          )}
                        </div>
                      </div>
                      <button style={{ background: 'none', border: 'none', padding: 8, color: '#d1d5db' }} onClick={() => deleteItem(item.id)}><Trash2 size={18} /></button>
                    </motion.div>
                    <AnimatePresence>
                      {movingItemId === item.id && (
                        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="move-menu" style={{ top: '10%', left: '50%', transform: 'translateX(-50%)' }}>
                          <div style={{ padding: '4px 8px', fontSize: '0.7rem', fontWeight: 800, color: 'var(--primary)' }}><ArrowRightLeft size={10} style={{ marginRight: 4 }} /> どこに移動する？</div>
                          {CATEGORIES.filter(c => c !== 'すべて' && c !== item.category).map(c => (
                            <div key={c} className="move-option" onClick={() => moveItem(item.id, c)}>{c}へ</div>
                          ))}
                          <div className="move-option" style={{ color: '#ef4444' }} onClick={() => setMovingItemId(null)}>キャンセル</div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </AnimatePresence>
            </div>
          </SwiperSlide>
        ))}
      </Swiper>

      <button className="add-btn" onClick={() => setIsModalOpen(true)}><Plus size={36} /></button>

      {/* Cloud Info Modal */}
      <AnimatePresence>
        {isInfoOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay" onClick={() => setIsInfoOpen(false)}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="modal-content" style={{ borderRadius: 32, margin: 20, width: 'calc(100% - 40px)', paddingBottom: 32 }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h2 className="modal-title" style={{ margin: 0 }}>クラウド連携中</h2>
                <button onClick={() => setIsInfoOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)' }}><X /></button>
              </div>

              <div style={{ background: '#f0f9ff', padding: 16, borderRadius: 16, textAlign: 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#0369a1', fontWeight: 800, fontSize: '0.85rem', marginBottom: 8 }}>
                  <Cloud size={16} /> クラウド保存のメリット
                </div>
                <ul style={{ fontSize: '0.8rem', color: '#075985', paddingLeft: 16, lineHeight: 1.6 }}>
                  <li><strong>外出先でも同期</strong>: どこからでも最新のリストが見れます。</li>
                  <li><strong>リアルタイム更新</strong>: 誰かが項目を消すと、即座に全員の画面に反映されます。</li>
                  <li><strong>安全な保存</strong>: Macの電源が切れてもデータは消えません。</li>
                </ul>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay" onClick={() => setIsModalOpen(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="modal-content" onClick={e => e.stopPropagation()}>
              <h2 className="modal-title">買わなきゃリスト</h2>
              <div className="form-group">
                <label>品名</label>
                <div style={{ position: 'relative' }}>
                  <input autoFocus className="form-input" value={newItemName} onChange={e => setNewItemName(e.target.value)} placeholder="例: 鶏肉" style={{ paddingRight: '50px' }} />
                  {newItemName && (
                    <motion.div key={predictEmoji(newItemName)} initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1.2, rotate: 0 }} style={{ position: 'absolute', right: '15px', top: '50%', transform: 'translateY(-50%)', fontSize: '1.5rem', pointerEvents: 'none' }}>
                      {predictEmoji(newItemName)}
                    </motion.div>
                  )}
                </div>
              </div>
              <div className="form-group">
                <label>カテゴリ</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {CATEGORIES.filter(c => c !== 'すべて').map(cat => (
                    <button key={cat} type="button" onClick={() => setNewItemCategory(cat)} className={`tab-item ${newItemCategory === cat ? 'active' : ''}`} style={{ border: '1px solid #fed7aa', fontSize: '0.75rem' }}>{cat}</button>
                  ))}
                </div>
              </div>
              <button className="submit-btn" onClick={addItem}>リストに追加</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
