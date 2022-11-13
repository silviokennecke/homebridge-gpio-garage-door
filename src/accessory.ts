import {
  AccessoryPlugin,
  API,
  Logger,
} from 'homebridge';
import storage from 'node-persist';
import GPIO from 'rpi-gpio';
import {AccessoryConfig} from 'homebridge/lib/bridgeService';
import * as http from 'node:http';
import * as jp from 'jsonpath-plus';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class GpioGarageDoorAccessory implements AccessoryPlugin {
  private storage;

  private webhookServer: http.Server | null = null;

  private informationService;
  private garageDoorService;

  private currentDoorStateKey = 'currentDoorState';
  private targetDoorStateKey = 'targetDoorState';
  private currentDoorState = this.api.hap.Characteristic.CurrentDoorState.CLOSED;
  private targetDoorState = this.api.hap.Characteristic.TargetDoorState.CLOSED;
  private obstructionDetected = false;

  private garageDoorMovingTimeout: any = null;

  private pinHigh = true;

  constructor(
    public readonly log: Logger,
    public readonly config: AccessoryConfig,
    public readonly api: API,
  ) {
    this.log.debug('Homebridge GPIO garage door loaded.');

    // init storage
    const cacheDir = this.api.user.persistPath();
    this.storage = storage.create();
    this.storage.initSync({dir: cacheDir, forgiveParseErrors: true});

    // add accessory information
    this.informationService = new this.api.hap.Service.AccessoryInformation()
      .setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'Homebridge')
      .setCharacteristic(this.api.hap.Characteristic.Model, 'GPIO garage door');

    // create new garage door accessory
    this.garageDoorService = new this.api.hap.Service.GarageDoorOpener(this.config.name);

    // add characteristics
    this.garageDoorService.getCharacteristic(this.api.hap.Characteristic.CurrentDoorState);
    this.garageDoorService.getCharacteristic(this.api.hap.Characteristic.TargetDoorState);
    this.garageDoorService.getCharacteristic(this.api.hap.Characteristic.ObstructionDetected);

    // restore persisted settings
    this.currentDoorState = this.storage.getItemSync(this.currentDoorStateKey)
      || this.storage.getItemSync(this.targetDoorStateKey)
      || this.currentDoorState;
    this.targetDoorState = this.storage.getItemSync(this.targetDoorStateKey)
      || this.targetDoorState;
    this.garageDoorService.updateCharacteristic(this.api.hap.Characteristic.CurrentDoorState, this.currentDoorState);
    this.garageDoorService.updateCharacteristic(this.api.hap.Characteristic.TargetDoorState, this.targetDoorState);
    this.garageDoorService.updateCharacteristic(this.api.hap.Characteristic.ObstructionDetected, this.obstructionDetected);

    // setup gpio
    this.setupGpio().then(() => {
      // setup events
      this.setupEvents();

      // execute last command
      if (this.currentDoorState !== this.targetDoorState) {
        this.setTargetDoorState(this.targetDoorState);
      }
    });

    // setup webhook server
    if (this.config.webhookEnabled) {
      this.webhookServer = http.createServer((request, response) => {
        let statusCode = 0;

        try {
          if (request.url === this.config.webhookPath) {
            this.log.debug('Received webhook request');

            if (request.method !== 'POST') {
              statusCode = 405;
              throw new Error('Invalid request method');
            }

            if (request.headers['content-type'] !== 'application/json') {
              statusCode = 415;
              throw new Error('Invalid content type');
            }

            let body = '';
            request.on('data', (chunk) => {
              body += chunk;
            });
            request.on('end', () => {
              const json = JSON.parse(body);
              this.log.debug('Received webhook request body:', json);

              const currentDoorState = jp.JSONPath({path: this.config.webhookTargetDoorStatePath, json});
              if (currentDoorState === undefined) {
                throw new Error('Invalid door state');
              }

              const doorOpen = this.config.webhookJsonValueReverse ? !currentDoorState : !!currentDoorState;
              const hkDoorState = doorOpen ? this.api.hap.Characteristic.CurrentDoorState.OPEN : this.api.hap.Characteristic.CurrentDoorState.CLOSED;

              this.externalStateChange(hkDoorState);
            });

            statusCode = 200;
          } else {
            statusCode = 404;
            throw new Error('Invalid webhook path');
          }
        } catch (e: any) {
          this.log.debug('Error handling webhook request:', e);
        }

        response.writeHead(statusCode || 500);
        response.end();
      });
      this.webhookServer.listen(this.config.webhookPort);
    }
  }

  getServices() {
    return [
      this.informationService,
      this.garageDoorService,
    ];
  }

  async setupGpio(): Promise<void> {
    this.pinHigh = !this.config.reverseOutput;

    await GPIO.promise.setup(this.config.gpioPinOpen, GPIO.DIR_OUT, GPIO.EDGE_BOTH);
    GPIO.write(this.config.gpioPinOpen, !this.pinHigh);

    if (this.config.gpioPinOpen !== this.config.gpioPinClose) {
      await GPIO.promise.setup(this.config.gpioPinClose, GPIO.DIR_OUT, GPIO.EDGE_BOTH);
      GPIO.write(this.config.gpioPinClose, !this.pinHigh);
    }

    if (this.config.gpioStateInputEnabled) {
      GPIO.on('change', this.gpioInputStateChange.bind(this));
      await GPIO.promise.setup(this.config.gpioPinState, GPIO.DIR_IN, GPIO.EDGE_BOTH);
    }
  }

  setupEvents(): void {
    // current state
    this.garageDoorService.getCharacteristic(this.api.hap.Characteristic.CurrentDoorState)
      .onGet(this.getCurrentDoorState.bind(this));

    // target door state
    this.garageDoorService.getCharacteristic(this.api.hap.Characteristic.TargetDoorState)
      .onGet(this.getTargetDoorState.bind(this))
      .onSet(this.setTargetDoorState.bind(this));

    // obstruction
    this.garageDoorService.getCharacteristic(this.api.hap.Characteristic.ObstructionDetected)
      .onGet(this.getObstructionDetected.bind(this));
  }

  gpioInputStateChange(channel: number, pinHighState: boolean): void {
    if (channel !== this.config.gpioPinState) {
      return;
    }

    this.log.debug('Garage door state changed via GPIO input:', pinHighState ? 'HIGH' : 'LOW');

    if (this.config.gpioStateInputReverse) {
      pinHighState = !pinHighState;
    }

    this.externalStateChange(
      pinHighState ?
        this.api.hap.Characteristic.CurrentDoorState.OPEN :
        this.api.hap.Characteristic.CurrentDoorState.CLOSED,
    );
  }

  protected getCurrentDoorState() {
    this.log.debug('getCurrentDoorState:', this.currentDoorState);
    return this.currentDoorState;
  }

  protected getTargetDoorState() {
    this.log.debug('getTargetDoorState:', this.targetDoorState);
    return this.targetDoorState;
  }

  protected setTargetDoorState(targetState) {
    if (!this.config.allowCommandOverride && this.isMoving()) {
      this.log.info('Command ignored, door is currently moving');
      this.garageDoorService.updateCharacteristic(this.api.hap.Characteristic.TargetDoorState, this.targetDoorState);
      return;
    }

    this.log.debug('setTargetDoorState:', targetState);
    this.targetDoorState = targetState;

    let targetGpioPin = -1;
    switch (this.targetDoorState) {
      case this.api.hap.Characteristic.TargetDoorState.OPEN:
        this.log.debug('Opening garage door');
        this.currentDoorState = this.api.hap.Characteristic.CurrentDoorState.OPENING;
        this.garageDoorService.updateCharacteristic(this.api.hap.Characteristic.CurrentDoorState, this.currentDoorState);
        targetGpioPin = this.config.gpioPinOpen;
        break;

      case this.api.hap.Characteristic.TargetDoorState.CLOSED:
        this.log.debug('Closing garage door');
        this.currentDoorState = this.api.hap.Characteristic.CurrentDoorState.CLOSING;
        this.garageDoorService.updateCharacteristic(this.api.hap.Characteristic.CurrentDoorState, this.currentDoorState);
        targetGpioPin = this.config.gpioPinClose;
        break;
    }

    this.persistCache();

    if (targetGpioPin > -1) {
      this.setGpio(targetGpioPin, this.pinHigh);

      setTimeout(() => {
        this.setGpio(targetGpioPin, !this.pinHigh);
      }, this.config.emitTime);

      this.garageDoorMovingTimeout = setTimeout(() => {
        this.currentDoorState = this.targetDoorState;
        this.garageDoorService.updateCharacteristic(this.api.hap.Characteristic.CurrentDoorState, this.currentDoorState);

        this.persistCache();
      }, this.config.executionTime * 1000);
    }
  }

  protected getObstructionDetected() {
    this.log.debug('getObstructionDetected:', this.obstructionDetected);
    return this.obstructionDetected;
  }

  private isMoving() {
    return this.currentDoorState !== this.targetDoorState;
  }

  private setGpio(pin: number, state: boolean): void {
    this.log.debug('Setting GPIO pin ' + pin + ' to ' + (state ? 'HIGH' : 'LOW'));
    GPIO.write(pin, state);
  }

  private externalStateChange(hkDoorState: number): void {
    // update current and target door state
    this.currentDoorState = hkDoorState;
    this.targetDoorState = hkDoorState;

    this.garageDoorService.updateCharacteristic(this.api.hap.Characteristic.CurrentDoorState, this.currentDoorState);
    this.garageDoorService.updateCharacteristic(this.api.hap.Characteristic.TargetDoorState, this.targetDoorState);

    this.persistCache();

    // cancel timeout
    if (this.garageDoorMovingTimeout) {
      clearTimeout(this.garageDoorMovingTimeout);
    }
  }

  private persistCache(): void {
    this.log.debug('Persisting accessory state');
    this.storage.setItemSync(this.currentDoorStateKey, this.currentDoorState);
    this.storage.setItemSync(this.targetDoorStateKey, this.targetDoorState);
  }
}
