const baseConfig = {
  name: "Medilink AI",
  slug: "medilink-ai-law",
  version: "1.0.0",
  scheme: "medilinkai",
  orientation: "portrait",
  userInterfaceStyle: "light",
  platforms: ["ios", "android", "web"],
  assetBundlePatterns: ["**/*"],
  updates: {
    url: "https://u.expo.dev/1e1bcdf3-68df-4c99-9391-92abb86a41fc",
    fallbackToCacheTimeout: 0,
  },
  runtimeVersion: {
    policy: "appVersion",
  },
  android: {
    package: "com.medilink.ai",
    versionCode: 1,
  },
  ios: {
    bundleIdentifier: "com.medilink.ai",
    buildNumber: "1",
  },
  web: {
    bundler: "metro",
  },
};

const appVariant = process.env.APP_VARIANT || "production";

const iosVariantMap = {
  development: {
    nameSuffix: " Dev",
    bundleSuffix: ".dev",
  },
  preview: {
    nameSuffix: " Preview",
    bundleSuffix: ".preview",
  },
  demo: {
    nameSuffix: " Demo",
    bundleSuffix: ".demo",
  },
  production: {
    nameSuffix: "",
    bundleSuffix: "",
  },
};

function getIosVariantConfig(variant) {
  return iosVariantMap[variant] || iosVariantMap.production;
}

module.exports = () => {
  const iosVariant = getIosVariantConfig(appVariant);

  return {
    expo: {
      ...baseConfig,
      name: `${baseConfig.name}${iosVariant.nameSuffix}`,
      ios: {
        ...baseConfig.ios,
        bundleIdentifier: `${baseConfig.ios.bundleIdentifier}${iosVariant.bundleSuffix}`,
        buildNumber: process.env.IOS_BUILD_NUMBER || baseConfig.ios.buildNumber,
        infoPlist: {
          NSCameraUsageDescription:
            "Use the camera to attach legal documents, evidence, and case notes.",
          NSPhotoLibraryUsageDescription:
            "Select screenshots, photos, and evidence from your library for legal review.",
          NSPhotoLibraryAddUsageDescription:
            "Save and reuse legal screenshots or reference images when needed.",
        },
      },
      extra: {
        appVariant,
        eas: {
          projectId: "1e1bcdf3-68df-4c99-9391-92abb86a41fc",
        },
      },
    },
  };
};
