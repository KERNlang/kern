# Dashboard Screen Spec

This is the reference screen that each forge engine must implement in the IR.

## Screen: FITVT Dashboard

A fitness tracking dashboard with:

1. **Header** — App title "FITVT" + user avatar (circular, 40px)
2. **Macro Summary Card** — Shows today's calories, protein, carbs, fat as progress bars
   - Each macro has: label, current value, target value, progress bar (filled %)
   - Card has rounded corners, shadow, padding 16
3. **Quick Log Button** — Primary action button "Log Meal" centered, full width, rounded
   - On press: navigates to `LogMeal` screen
4. **Recent Meals List** — Scrollable list of last 5 meals
   - Each item: meal name, time, calorie count
   - Flat list, separator between items
5. **Bottom Tab Bar** — 4 tabs: Dashboard (active), Log, Stats, Settings
   - Icons + labels, active tab highlighted

## Data Types

```typescript
interface MacroData {
  label: string;     // "Calories" | "Protein" | "Carbs" | "Fat"
  current: number;
  target: number;
  unit: string;      // "kcal" | "g"
  color: string;     // hex color for progress bar
}

interface MealEntry {
  id: string;
  name: string;
  time: string;      // ISO timestamp
  calories: number;
}
```

## Expected Output

The transpiled React Native TypeScript should be a functional component using:
- `View`, `Text`, `TouchableOpacity`, `FlatList`, `ScrollView` from react-native
- `StyleSheet.create` for styles
- Standard React Native patterns (no external UI libraries)
