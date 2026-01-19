/**
 * Yandex Games SDK Wrapper
 * Provides integration with Yandex Games platform
 */
(function() {
    'use strict';

    var YandexSDK = {
        ysdk: null,
        player: null,
        isInitialized: false,
        isPlayerInitialized: false,
        verbose: true,

        // Throttling settings for player.setData()
        SAVE_INTERVAL: 60000, // Minimum interval between saves (1 minute)
        lastSaveTime: 0,
        pendingData: null,
        saveTimer: null,
        isSaving: false,

        /**
         * Initialize the Yandex Games SDK
         * @returns {Promise} Resolves when SDK is ready
         */
        init: function() {
            var self = this;
            return new Promise(function(resolve, reject) {
                if (typeof YaGames === 'undefined') {
                    self.log('YaGames is not defined. SDK script may not be loaded.');
                    reject(new Error('YaGames not available'));
                    return;
                }

                YaGames.init()
                    .then(function(ysdk) {
                        self.ysdk = ysdk;
                        self.isInitialized = true;
                        self.log('Yandex SDK initialized successfully');
                        resolve(ysdk);
                    })
                    .catch(function(error) {
                        self.log('Failed to initialize Yandex SDK:', error);
                        reject(error);
                    });
            });
        },

        /**
         * Initialize player with optional scopes
         * @param {boolean} requireAuth - Whether to require authorization
         * @returns {Promise} Resolves with player object
         */
        initPlayer: function(requireAuth) {
            var self = this;
            requireAuth = requireAuth || false;

            return new Promise(function(resolve, reject) {
                if (!self.isInitialized || !self.ysdk) {
                    self.log('SDK not initialized. Call init() first.');
                    reject(new Error('SDK not initialized'));
                    return;
                }

                self.ysdk.getPlayer({ scopes: requireAuth })
                    .then(function(player) {
                        self.player = player;
                        self.isPlayerInitialized = true;
                        self.log('Player initialized. Authorized:', player.getMode() !== 'lite');
                        resolve(player);
                    })
                    .catch(function(error) {
                        self.log('Failed to initialize player:', error);
                        reject(error);
                    });
            });
        },

        /**
         * Internal method to actually perform the save
         * @param {Object} data - Data to save
         * @param {boolean} flush - Whether to flush immediately
         * @returns {Promise}
         */
        _doSave: function(data, flush) {
            var self = this;

            return new Promise(function(resolve, reject) {
                if (!self.isPlayerInitialized || !self.player) {
                    self.log('Player not initialized. Cannot save data.');
                    reject(new Error('Player not initialized'));
                    return;
                }

                self.isSaving = true;
                self.player.setData(data, flush)
                    .then(function() {
                        self.lastSaveTime = Date.now();
                        self.isSaving = false;
                        self.log('Data saved to Yandex cloud successfully');
                        resolve();
                    })
                    .catch(function(error) {
                        self.isSaving = false;
                        self.log('Failed to save data to Yandex cloud:', error);
                        reject(error);
                    });
            });
        },

        /**
         * Save player data to Yandex cloud with throttling
         * Saves at most once per SAVE_INTERVAL (1 minute)
         * @param {Object} data - Data to save
         * @param {boolean} flush - Whether to flush immediately
         * @returns {Promise}
         */
        saveData: function(data, flush) {
            var self = this;
            flush = flush !== false; // default true

            // Always store the latest data
            self.pendingData = { data: data, flush: flush };

            return new Promise(function(resolve, reject) {
                if (!self.isPlayerInitialized || !self.player) {
                    self.log('Player not initialized. Cannot save data.');
                    reject(new Error('Player not initialized'));
                    return;
                }

                var now = Date.now();
                var timeSinceLastSave = now - self.lastSaveTime;

                // If enough time has passed, save immediately
                if (timeSinceLastSave >= self.SAVE_INTERVAL) {
                    // Clear any pending timer
                    if (self.saveTimer) {
                        clearTimeout(self.saveTimer);
                        self.saveTimer = null;
                    }

                    self.pendingData = null;
                    self._doSave(data, flush).then(resolve).catch(reject);
                } else {
                    // Schedule save for when the interval expires
                    var delay = self.SAVE_INTERVAL - timeSinceLastSave;

                    if (!self.saveTimer) {
                        self.log('Scheduling save in ' + Math.round(delay / 1000) + 's (throttled)');
                        self.saveTimer = setTimeout(function() {
                            self.saveTimer = null;
                            if (self.pendingData) {
                                var pending = self.pendingData;
                                self.pendingData = null;
                                self._doSave(pending.data, pending.flush);
                            }
                        }, delay);
                    }

                    // Resolve immediately since save is scheduled
                    resolve();
                }
            });
        },

        /**
         * Force immediate save of pending data (used on page unload/visibility change)
         * @returns {Promise}
         */
        flushPendingData: function() {
            var self = this;

            // Clear any scheduled save
            if (self.saveTimer) {
                clearTimeout(self.saveTimer);
                self.saveTimer = null;
            }

            if (self.pendingData && !self.isSaving) {
                var pending = self.pendingData;
                self.pendingData = null;
                self.log('Flushing pending data immediately');
                return self._doSave(pending.data, pending.flush);
            }

            return Promise.resolve();
        },

        /**
         * Load player data from Yandex cloud
         * @param {Array} keys - Optional array of keys to load
         * @returns {Promise} Resolves with player data
         */
        loadData: function(keys) {
            var self = this;

            return new Promise(function(resolve, reject) {
                if (!self.isPlayerInitialized || !self.player) {
                    self.log('Player not initialized. Cannot load data.');
                    reject(new Error('Player not initialized'));
                    return;
                }

                self.player.getData(keys)
                    .then(function(data) {
                        self.log('Data loaded from Yandex cloud:', data);
                        resolve(data);
                    })
                    .catch(function(error) {
                        self.log('Failed to load data from Yandex cloud:', error);
                        reject(error);
                    });
            });
        },

        /**
         * Show rewarded video advertisement
         * @param {Object} callbacks - Callback functions
         * @param {Function} callbacks.onOpen - Called when ad opens
         * @param {Function} callbacks.onRewarded - Called when user earns reward
         * @param {Function} callbacks.onClose - Called when ad closes
         * @param {Function} callbacks.onError - Called on error
         */
        showRewardedVideo: function(callbacks) {
            var self = this;
            callbacks = callbacks || {};

            if (!self.isInitialized || !self.ysdk) {
                self.log('SDK not initialized. Cannot show rewarded video.');
                if (callbacks.onError) {
                    callbacks.onError(new Error('SDK not initialized'));
                }
                return;
            }

            self.ysdk.adv.showRewardedVideo({
                callbacks: {
                    onOpen: function() {
                        self.log('Rewarded video opened');
                        if (callbacks.onOpen) callbacks.onOpen();
                    },
                    onRewarded: function() {
                        self.log('User rewarded');
                        if (callbacks.onRewarded) callbacks.onRewarded();
                    },
                    onClose: function() {
                        self.log('Rewarded video closed');
                        if (callbacks.onClose) callbacks.onClose();
                    },
                    onError: function(error) {
                        self.log('Rewarded video error:', error);
                        if (callbacks.onError) callbacks.onError(error);
                    }
                }
            });
        },

        /**
         * Signal that the game is fully loaded and ready
         */
        gameReady: function() {
            var self = this;
            if (!self.isInitialized || !self.ysdk) {
                self.log('SDK not initialized. Cannot signal game ready.');
                return;
            }

            try {
                self.ysdk.features.LoadingAPI.ready();
                self.log('LoadingAPI.ready() called');
            } catch (error) {
                self.log('Error calling LoadingAPI.ready():', error);
            }
        },

        /**
         * Signal that gameplay has started
         */
        gameplayStart: function() {
            var self = this;
            if (!self.isInitialized || !self.ysdk) {
                self.log('SDK not initialized. Cannot signal gameplay start.');
                return;
            }

            try {
                self.ysdk.features.GameplayAPI.start();
                self.log('GameplayAPI.start() called');
            } catch (error) {
                self.log('Error calling GameplayAPI.start():', error);
            }
        },

        /**
         * Signal that gameplay has stopped
         */
        gameplayStop: function() {
            var self = this;
            if (!self.isInitialized || !self.ysdk) {
                self.log('SDK not initialized. Cannot signal gameplay stop.');
                return;
            }

            try {
                self.ysdk.features.GameplayAPI.stop();
                self.log('GameplayAPI.stop() called');
            } catch (error) {
                self.log('Error calling GameplayAPI.stop():', error);
            }
        },

        /**
         * Get the current language setting
         * @returns {string} Language code
         */
        getLanguage: function() {
            var self = this;
            if (!self.isInitialized || !self.ysdk) {
                self.log('SDK not initialized. Returning default language.');
                return 'ru';
            }

            try {
                return self.ysdk.environment.i18n.lang || 'ru';
            } catch (error) {
                self.log('Error getting language:', error);
                return 'ru';
            }
        },

        /**
         * Set the current language
         * @param {string} lang - Language code
         */
        setLanguage: function(lang) {
            var self = this;
            if (!self.isInitialized || !self.ysdk) {
                self.log('SDK not initialized. Cannot set language.');
                return;
            }

            try {
                if (self.ysdk.environment && self.ysdk.environment.i18n) {
                    if (typeof self.ysdk.environment.i18n.lang === 'function') {
                        self.ysdk.environment.i18n.lang(lang);
                    } else {
                        self.ysdk.environment.i18n.lang = lang;
                    }
                    self.log('Language set to', lang);
                }
            } catch (error) {
                self.log('Error setting language:', error);
            }
        },

        /**
         * Logging helper
         */
        log: function() {
            if (this.verbose) {
                var args = ['[YandexSDK]'].concat(Array.prototype.slice.call(arguments));
                console.log.apply(console, args);
            }
        }
    };

    // Block right-click context menu
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        return false;
    });

    // Block long-press context menu on mobile
    document.addEventListener('touchstart', function(e) {
        if (e.touches.length > 1) {
            e.preventDefault();
        }
    }, { passive: false });

    // Prevent long-press on mobile triggering context menu
    var longPressTimer;
    document.addEventListener('touchstart', function() {
        longPressTimer = setTimeout(function() {}, 500);
    }, { passive: true });

    document.addEventListener('touchend', function() {
        clearTimeout(longPressTimer);
    }, { passive: true });

    document.addEventListener('touchmove', function() {
        clearTimeout(longPressTimer);
    }, { passive: true });

    // CSS to disable context menu and text selection on touch devices
    var style = document.createElement('style');
    style.textContent = [
        '* {',
        '    -webkit-touch-callout: none;',
        '    -webkit-user-select: none;',
        '    -khtml-user-select: none;',
        '    -moz-user-select: none;',
        '    -ms-user-select: none;',
        '    user-select: none;',
        '    -webkit-tap-highlight-color: transparent;',
        '}'
    ].join('\n');
    document.head.appendChild(style);

    // Expose to global scope
    window.YandexSDK = YandexSDK;

    // Also expose as ig.yandex when ig is available
    if (typeof ig !== 'undefined') {
        ig.yandex = YandexSDK;
    }

    // Auto-initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', function() {
        YandexSDK.init()
            .then(function() {
                return YandexSDK.initPlayer(false);
            })
            .then(function() {
                YandexSDK.log('SDK and Player fully initialized');
            })
            .catch(function(error) {
                YandexSDK.log('Initialization failed:', error);
            });
    });

    // Save pending data when page visibility changes (user switches tabs)
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') {
            YandexSDK.log('Page hidden - flushing pending save data');
            YandexSDK.flushPendingData();
        }
    });

    // Save pending data before page unload
    window.addEventListener('beforeunload', function() {
        YandexSDK.log('Page unloading - flushing pending save data');
        YandexSDK.flushPendingData();
    });

    // Also handle pagehide for mobile browsers
    window.addEventListener('pagehide', function() {
        YandexSDK.log('Page hide - flushing pending save data');
        YandexSDK.flushPendingData();
    });
})();
