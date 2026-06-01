/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './components/Login';
import ChatLayout from './components/ChatLayout';

function AppContent() {
  const { user } = useAuth();
  return user ? <ChatLayout /> : <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
