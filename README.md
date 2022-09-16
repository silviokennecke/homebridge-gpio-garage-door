<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>

[![npm](https://badgen.net/npm/v/@silviokennecke/homebridge-gpio-garage-door/latest?icon=npm&label)](https://www.npmjs.com/package/@silviokennecke/homebridge-gpio-garage-door)
[![npm](https://badgen.net/npm/dt/@silviokennecke/homebridge-gpio-garage-door?label=downloads)](https://www.npmjs.com/package/@silviokennecke/homebridge-gpio-garage-door)
[![release](https://badgen.net/github/release/silviokennecke/homebridge-gpio-garage-door)](https://github.com/silviokennecke/homebridge-gpio-garage-door/releases)
[![license](https://badgen.net/github/license/silviokennecke/homebridge-gpio-garage-door)](https://github.com/silviokennecke/homebridge-gpio-garage-door/blob/main/LICENSE)
[![lint & build](https://github.com/silviokennecke/homebridge-gpio-garage-door/actions/workflows/build.yml/badge.svg)](https://github.com/silviokennecke/homebridge-gpio-garage-door/actions/workflows/build.yml)

# Homebridge GPIO garage door

This plugin uses the GPIO output of the Raspberry PI to provide a HomeKit garage door.

> :warning: This plugin is only designed for and tested on Raspberry PI.
> There's no guarantee, the plugin works also on other boards equipped with GPIO!

## Configuration

| key                  | type    | description                                                                                                                                    |
|----------------------|---------|------------------------------------------------------------------------------------------------------------------------------------------------|
| name                 | string  | The name of the accessory.                                                                                                                     | 
| gpioPinOpen          | integer | The GPIO pin the plugin should use to open the garage door.                                                                                    | 
| gpioPinClose         | integer | The GPIO pin the plugin should use to close the garage door. If empty, gpioPinOpen is used to open and close the garage door.                  | 
| emitTime             | integer | How many milliseconds should the GPIO output be HIGH?                                                                                          | 
| executionTime        | integer | How many seconds does the garage door to execute an open or close command?                                                                     |
| allowCommandOverride | boolean | If true, the plugin will allow to send a new command (e.g. open) to the garage door while it's already executing another command (e.g. close). |
| reverseOutput        | boolean | If enabled, a open signal will be sent as HIGH-LOW-HIGH, instead of the default behaviour LOW-HIGH-LOW.                                        |

## Support & Contribution

This project is not commercially developed or maintained.
Therefore, it might take some time after opening an issue until it is solved.
But anyway: If you experience any bugs feel free to open an issue or create a pull request.
Contribution is always welcome.
