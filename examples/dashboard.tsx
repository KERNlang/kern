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
        <View label="Calories" current="1840" target="2200" unit="kcal" color="#FF6B6B">
          <Text>Calories: 1840/2200 kcal</Text>
          <View style={styles.progressBar_5}>
            <View style={styles.progressFill_6} />
          </View>
        </View>
        <View label="Protein" current="96" target="140" unit="g" color="#4ECDC4">
          <Text>Protein: 96/140 g</Text>
          <View style={styles.progressBar_7}>
            <View style={styles.progressFill_8} />
          </View>
        </View>
        <View label="Carbs" current="210" target="260" unit="g" color="#FFD166">
          <Text>Carbs: 210/260 g</Text>
          <View style={styles.progressBar_9}>
            <View style={styles.progressFill_10} />
          </View>
        </View>
        <View label="Fat" current="58" target="70" unit="g" color="#6C5CE7">
          <Text>Fat: 58/70 g</Text>
          <View style={styles.progressBar_11}>
            <View style={styles.progressFill_12} />
          </View>
        </View>
      </View>
      <TouchableOpacity style={styles.button_13} to="LogMeal">
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
  progressBar_5: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E0E0E0',
    overflow: 'hidden',
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
  buttonText: {
    color: '#FFFFFF',
    textAlign: 'center',
    fontWeight: 'bold',
  },
});

export default Dashboard;