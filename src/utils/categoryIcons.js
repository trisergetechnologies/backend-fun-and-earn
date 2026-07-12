/** Allowed Ionicons names for eCart categories (Dream Mart + Admin). */
const DEFAULT_CATEGORY_ICON = 'grid-outline';

const CATEGORY_ICONS = [
  'grid-outline',
  'shirt-outline',
  'phone-portrait-outline',
  'home-outline',
  'gift-outline',
  'restaurant-outline',
  'fitness-outline',
  'book-outline',
  'bag-outline',
  'watch-outline',
  'laptop-outline',
  'headset-outline',
  'game-controller-outline',
  'cafe-outline',
  'car-outline',
  'bicycle-outline',
  'flower-outline',
  'paw-outline',
  'color-palette-outline',
  'diamond-outline',
  'balloon-outline',
  'basket-outline',
  'bed-outline',
  'camera-outline',
  'musical-notes-outline',
  'medkit-outline',
  'sparkles-outline',
  'tv-outline',
  'wine-outline',
  'football-outline',
];

function resolveCategoryIcon(icon) {
  if (typeof icon === 'string' && CATEGORY_ICONS.includes(icon.trim())) {
    return icon.trim();
  }
  return DEFAULT_CATEGORY_ICON;
}

module.exports = {
  DEFAULT_CATEGORY_ICON,
  CATEGORY_ICONS,
  resolveCategoryIcon,
};
