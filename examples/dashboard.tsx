'use client';

import React from 'react';

const styles: Record<string, React.CSSProperties> = {
  screen_0: {
    backgroundColor: '#F8F9FA',
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
  },
  row_1: {
    padding: 16,
    justifyContent: 'space-between',
    alignItems: 'center',
    display: 'flex',
    flexDirection: 'row',
  },
  text_2: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  image_3: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  card_4: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#FFF',
    margin: 16,
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  progressBar_5: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E0E0E0',
    overflow: 'hidden',
    width: '100%',
  },
  progressFill_6: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF6B6B',
    width: '84%',
  },
  progressBar_7: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E0E0E0',
    overflow: 'hidden',
    width: '100%',
  },
  progressFill_8: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4ECDC4',
    width: '69%',
  },
  progressBar_9: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E0E0E0',
    overflow: 'hidden',
    width: '100%',
  },
  progressFill_10: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFD166',
    width: '81%',
  },
  progressBar_11: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E0E0E0',
    overflow: 'hidden',
    width: '100%',
  },
  progressFill_12: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#6C5CE7',
    width: '83%',
  },
  button_13: {
    width: '100%',
    borderRadius: 8,
    backgroundColor: '#007AFF',
    padding: 16,
  },
  progressLabel: {
    fontSize: 14,
    marginBottom: 4,
  },
};

export default function Dashboard() {
  return (
    <div className={styles.screen_0} name="Dashboard">
      <div className={styles.row_1}>
        <span className={styles.text_2}>
          {"FITVT"}
        </span>
        <img className={styles.image_3} src="/avatar.png" alt="avatar" />
      </div>
      <div className={styles.card_4}>
        <div label="Calories" current="1840" target="2200" unit="kcal" color="#FF6B6B">
          <span className={styles.progressLabel}>Calories: 1840/2200 kcal</span>
          <div className={styles.progressBar_5}>
            <div className={styles.progressFill_6} />
          </div>
        </div>
        <div label="Protein" current="96" target="140" unit="g" color="#4ECDC4">
          <span className={styles.progressLabel}>Protein: 96/140 g</span>
          <div className={styles.progressBar_7}>
            <div className={styles.progressFill_8} />
          </div>
        </div>
        <div label="Carbs" current="210" target="260" unit="g" color="#FFD166">
          <span className={styles.progressLabel}>Carbs: 210/260 g</span>
          <div className={styles.progressBar_9}>
            <div className={styles.progressFill_10} />
          </div>
        </div>
        <div label="Fat" current="58" target="70" unit="g" color="#6C5CE7">
          <span className={styles.progressLabel}>Fat: 58/70 g</span>
          <div className={styles.progressBar_11}>
            <div className={styles.progressFill_12} />
          </div>
        </div>
      </div>
      <button className={styles.button_13} onClick={() => router.push('/LogMeal')}>
        Log Meal
      </button>
      <ul title="Recent Meals" separator="true">
        <li id="m1" name="Greek Yogurt Bowl" time="08:15" calories="320" />
        <li id="m2" name="Chicken Salad" time="12:40" calories="540" />
        <li id="m3" name="Protein Shake" time="15:10" calories="220" />
        <li id="m4" name="Salmon Rice Bowl" time="18:30" calories="680" />
        <li id="m5" name="Casein Pudding" time="21:00" calories="190" />
      </ul>
      <nav data-active="Dashboard">
        <button icon="home" label="Dashboard" />
        <button icon="plus" label="Log" />
        <button icon="chart" label="Stats" />
        <button icon="gear" label="Settings" />
      </nav>
    </div>
  );
}