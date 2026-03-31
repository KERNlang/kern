// BUG: useState called inside a conditional — violates Rules of Hooks
import React, { useState } from 'react';

export function Profile(props: { loggedIn: boolean }) {
  if (props.loggedIn) {
    const [name, setName] = useState(''); // hook inside condition
    return React.createElement('span', null, name);
  }
  return React.createElement('span', null, 'Guest');
}
