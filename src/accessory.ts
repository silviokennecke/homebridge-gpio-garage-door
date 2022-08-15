import {
  AccessoryPlugin,
  API,
  Logger,
} from 'homebridge';
import storage from 'node-persist';
import GPIO from 'rpi-gpio';
import {AccessoryConfig} from 'homebridge/lib/bridgeService';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class GpioGarageDoorAccessory implements AccessoryPlugin {
  private storage;

  private informationService;
  private garageDoorService;

  private currentDoorStateKey = 'currentDoorState';
  private targetDoorStateKey = 'targetDoorState';
  private currentDoorState = this.api.hap.Characteristic.CurrentDoorState.CLOSED;
  private targetDoorState = this.api.hap.Characteristic.TargetDoorState.CLOSED;
  private obstructionDetected = false;

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
    this.currentDoorState = this.storage.getItemSync(this.currentDoorStateKey) || this.storage.getItemSync(this.targetDoorStateKey) || this.currentDoorState;
    this.targetDoorState = this.storage.getItemSync(this.targetDoorStateKey) || this.targetDoorState;
    this.garageDoorService.updateCharacteristic(this.api.hap.Characteristic.CurrentDoorState, this.currentDoorState);
    this.garageDoorService.updateCharacteristic(this.api.hap.Characteristic.TargetDoorState, this.targetDoorState);
    this.garageDoorService.updateCharacteristic(this.api.hap.Characteristic.ObstructionDetected, this.obstructionDetected);

    // setup events
    this.setupEvents();

    // setup gpio
    this.setupGpio();

    // execute last command
    if (this.currentDoorState !== this.targetDoorState) {
      this.setTargetDoorState(this.targetDoorState);
    }
  }

  getServices() {
    return [
      this.informationService,
      this.garageDoorService,
    ];
  }

  setupGpio(): void {
    this.pinHigh = !this.config.reverseOutput;

    GPIO.setup(this.config.gpioPinOpen, GPIO.DIR_OUT, GPIO.EDGE_BOTH);
    GPIO.setup(this.config.gpioPinClose, GPIO.DIR_OUT, GPIO.EDGE_BOTH);

    GPIO.write(this.config.gpioPinOpen, !this.pinHigh);
    GPIO.write(this.config.gpioPinClose, !this.pinHigh);
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

  protected getCurrentDoorState() {
    return this.currentDoorState;
  }

  protected getTargetDoorState() {
    return this.targetDoorState;
  }

  protected setTargetDoorState(targetState) {
    this.targetDoorState = targetState;

    let targetGpioPin = -1;
    switch (this.targetDoorState) {
      case this.api.hap.Characteristic.TargetDoorState.OPEN:
        this.currentDoorState = this.api.hap.Characteristic.CurrentDoorState.OPENING;
        this.garageDoorService.updateCharacteristic(this.api.hap.Characteristic.CurrentDoorState, this.currentDoorState);
        targetGpioPin = this.config.gpioPinOpen;
        break;

      case this.api.hap.Characteristic.TargetDoorState.CLOSED:
        this.currentDoorState = this.api.hap.Characteristic.CurrentDoorState.CLOSING;
        this.garageDoorService.updateCharacteristic(this.api.hap.Characteristic.CurrentDoorState, this.currentDoorState);
        targetGpioPin = this.config.gpioPinClose;
        break;
    }

    this.persistCache();

    if (targetGpioPin > -1) {
      GPIO.write(targetGpioPin, this.pinHigh);
      setTimeout(() => {
        GPIO.write(targetGpioPin, !this.pinHigh);

        this.currentDoorState = this.targetDoorState;
        this.garageDoorService.updateCharacteristic(this.api.hap.Characteristic.CurrentDoorState, this.currentDoorState);

        this.persistCache();
      }, this.config.emitTime);
    }
  }

  protected getObstructionDetected() {
    return this.obstructionDetected;
  }

  private persistCache(): void {
    this.storage.setItemSync(this.currentDoorStateKey, this.currentDoorState);
    this.storage.setItemSync(this.targetDoorState, this.targetDoorState);
  }
}
