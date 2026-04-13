// BUG: setState called directly in render body — infinite re-render loop
import React, { useState } from 'react';

export function Counter() {
  const [count, setCount] = useState(0);
  setCount(count + 1); // side effect in render body
  return React.createElement('span', null, count);
}
