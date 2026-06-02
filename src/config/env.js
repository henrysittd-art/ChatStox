const ENV = {
  dev:  { API_URL: 'http://localhost:8080' },
  prod: { API_URL: 'https://chatstox-backend-dudyphhb2a-uc.a.run.app' },
};

const getEnvVars = () => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return ENV.dev;
  return ENV.prod;
};

export default getEnvVars();
