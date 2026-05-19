import 'react-native-gesture-handler';
import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { createStackNavigator } from '@react-navigation/stack';
import { TabProvider }      from './src/context/TabContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LanguageProvider } from './src/context/LanguageContext';

import LandingScreen      from './src/screens/LandingScreen';
import HomeScreen         from './src/screens/HomeScreen';
import StockChatScreen    from './src/screens/StockChatScreen';
import GeneralChatScreen  from './src/screens/GeneralChatScreen';
import AuthScreen         from './src/screens/AuthScreen';
import OnboardingScreen   from './src/screens/OnboardingScreen';
import SettingsScreen     from './src/screens/SettingsScreen';
import SidebarDrawer      from './src/components/SidebarDrawer';

const Drawer = createDrawerNavigator();
const Stack  = createStackNavigator();

function MainDrawer() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <SidebarDrawer {...props} />}
      screenOptions={{
        headerShown: false,
        drawerStyle: {
          width: 280,
          backgroundColor: '#fff',
          shadowColor: '#0a1628',
          shadowOffset: { width: 4, height: 0 },
          shadowOpacity: 0.15,
          shadowRadius: 20,
          elevation: 20,
        },
        overlayColor: 'rgba(10,22,40,0.45)',
      }}
    >
      <Drawer.Screen name="Landing"     component={LandingScreen} />
      <Drawer.Screen name="Home"        component={HomeScreen} />
      <Drawer.Screen name="StockChat"   component={StockChatScreen} />
      <Drawer.Screen name="GeneralChat" component={GeneralChatScreen} />
      <Drawer.Screen name="Settings"    component={SettingsScreen} />
    </Drawer.Navigator>
  );
}

// Must be inside AuthProvider so it can call useAuth()
function AppNavigator() {
  const { user, profile, loading, profileLoading } = useAuth();
  const [timedOut, setTimedOut] = useState(false);

  // Safety net: if loading states never resolve, unblock after 5 s
  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), 5000);
    return () => clearTimeout(id);
  }, []);

  const isLoading = !timedOut && (loading || (user && profileLoading));

  if (isLoading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#f5a623" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animationEnabled: true }}>
      {!user ? (
        // ── Not authenticated ──────────────────────────────────────
        <>
          <Stack.Screen name="Auth"  component={AuthScreen} />
          <Stack.Screen name="Main"  component={MainDrawer} />
        </>
      ) : profile && !profile.onboardingComplete ? (
        // ── Authenticated but onboarding not done ──────────────────
        // profile must be non-null: null means still loading, not "not onboarded"
        <>
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          <Stack.Screen name="Main"       component={MainDrawer} />
        </>
      ) : (
        // ── Fully onboarded (or profile still loading — splash covers this) ──
        <Stack.Screen name="Main" component={MainDrawer} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <LanguageProvider>
          <TabProvider>
            <NavigationContainer>
              <AppNavigator />
            </NavigationContainer>
          </TabProvider>
        </LanguageProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#0a1628',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
