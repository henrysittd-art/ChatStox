import 'react-native-gesture-handler';
import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { createStackNavigator } from '@react-navigation/stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TabProvider } from './src/context/TabContext';
import { AuthProvider } from './src/context/AuthContext';

import OnboardingScreen from './src/screens/OnboardingScreen';
import LandingScreen from './src/screens/LandingScreen';
import HomeScreen from './src/screens/HomeScreen';
import StockChatScreen from './src/screens/StockChatScreen';
import GeneralChatScreen from './src/screens/GeneralChatScreen';
import AuthScreen from './src/screens/AuthScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import SidebarDrawer from './src/components/SidebarDrawer';

const Drawer = createDrawerNavigator();
const Stack = createStackNavigator();

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
      <Drawer.Screen name="Landing" component={LandingScreen} />
      <Drawer.Screen name="Home" component={HomeScreen} />
      <Drawer.Screen name="StockChat" component={StockChatScreen} />
      <Drawer.Screen name="GeneralChat" component={GeneralChatScreen} />
      <Drawer.Screen name="Settings" component={SettingsScreen} />
    </Drawer.Navigator>
  );
}

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [hasProfile, setHasProfile] = useState(false);

  useEffect(() => {
    const checkProfile = async () => {
      try {
        const profile = await AsyncStorage.getItem('userProfile');
        setHasProfile(!!profile);
      } catch (e) {
        setHasProfile(false);
      } finally {
        setIsLoading(false);
      }
    };
    checkProfile();
  }, []);

  if (isLoading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#f5a623" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
      <TabProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false, animationEnabled: true }}>
            {!hasProfile ? (
              <Stack.Screen name="Onboarding" component={OnboardingScreen} />
            ) : null}
            <Stack.Screen name="Main" component={MainDrawer} />
            <Stack.Screen name="Auth" component={AuthScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </TabProvider>
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
