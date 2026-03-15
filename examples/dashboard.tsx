import React from 'react';
import { Image, Text, TouchableOpacity, View, StyleSheet } from 'react-native';

const Dashboard: React.FC = () => {
  return (
    <View style={styles.screen_0} name="Dashboard">
      <View style={styles.row_1}>
        <Text style={styles.text_2}>
          {"FITVT"}
        </Text>
        <Image style={styles.image_3} source={require('./avatar')} />
      </View>
      <View style={styles.card_4}>
        <View style={styles.progress_5} label="Calories" current="1840" target="2200" unit="kcal" color="#FF6B6B">
          <Text>Calories: 1840/2200 kcal</Text>
          <View style={styles.progressBar_6}>
            <View style={styles.progressFill_7} />
          </View>
        </View>
        <View style={styles.progress_8} label="Protein" current="96" target="140" unit="g" color="#4ECDC4">
          <Text>Protein: 96/140 g</Text>
          <View style={styles.progressBar_9}>
            <View style={styles.progressFill_10} />
          </View>
        </View>
        <View style={styles.progress_11} label="Carbs" current="210" target="260" unit="g" color="#FFD166">
          <Text>Carbs: 210/260 g</Text>
          <View style={styles.progressBar_12}>
            <View style={styles.progressFill_13} />
          </View>
        </View>
        <View style={styles.progress_14} label="Fat" current="58" target="70" unit="g" color="#6C5CE7">
          <Text>Fat: 58/70 g</Text>
          <View style={styles.progressBar_15}>
            <View style={styles.progressFill_16} />
          </View>
        </View>
      </View>
      <TouchableOpacity style={styles.button_17} to="LogMeal">
        <Text style={styles.buttonText}>Log Meal</Text>
      </TouchableOpacity>
      <View title="Recent Meals" separator="true">
        <View id="m1" name="Greek Yogurt Bowl" time="08:15" calories="320" />
        <View id="m2" name="Chicken Salad" time="12:40" calories="540" />
        <View id="m3" name="Protein Shake" time="15:10" calories="220" />
        <View id="m4" name="Salmon Rice Bowl" time="18:30" calories="680" />
        <View id="m5" name="Casein Pudding" time="21:00" calories="190" />
      </View>
      <View active="Dashboard">
        <TouchableOpacity icon="home" label="Dashboard" />
        <TouchableOpacity icon="plus" label="Log" />
        <TouchableOpacity icon="chart" label="Stats" />
        <TouchableOpacity icon="gear" label="Settings" />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  screen_0: {
    backgroundColor: '#F8F9FA',
  },
  row_1: {
    padding: 16,
    justifyContent: 'space-between',
    alignItems: 'center',
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
  },
  progress_5: {
    height: 8,
    borderRadius: 4,
  },
  progressBar_6: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E0E0E0',
    overflow: 'hidden',
  },
  progressFill_7: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF6B6B',
    width: '84%',
  },
  progress_8: {
    height: 8,
    borderRadius: 4,
  },
  progressBar_9: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E0E0E0',
    overflow: 'hidden',
  },
  progressFill_10: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4ECDC4',
    width: '69%',
  },
  progress_11: {
    height: 8,
    borderRadius: 4,
  },
  progressBar_12: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E0E0E0',
    overflow: 'hidden',
  },
  progressFill_13: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFD166',
    width: '81%',
  },
  progress_14: {
    height: 8,
    borderRadius: 4,
  },
  progressBar_15: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E0E0E0',
    overflow: 'hidden',
  },
  progressFill_16: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#6C5CE7',
    width: '83%',
  },
  button_17: {
    width: '100%',
    borderRadius: 8,
    backgroundColor: '#007AFF',
    padding: 16,
  },
  buttonText: {
    color: '#FFFFFF',
    textAlign: 'center',
    fontWeight: 'bold',
  },
});

export default Dashboard;