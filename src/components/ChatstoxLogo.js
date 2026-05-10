import React from 'react';
import { Image } from 'react-native';

const iconImg = require('../assets/chatstox-icon.png');
const logoImg = require('../assets/chatstox-logo.png');

export const LogoIcon = ({ size = 44 }) => (
  <Image
    source={iconImg}
    style={{ width: size, height: size }}
    resizeMode="contain"
  />
);

export const LogoFull = ({ height = 36 }) => (
  <Image
    source={logoImg}
    style={{ height: height, width: height * 5 }}
    resizeMode="contain"
  />
);

export default LogoIcon;
