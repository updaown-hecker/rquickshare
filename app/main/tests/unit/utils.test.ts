import { describe, expect, it } from 'vitest'
import { utils } from '../../src/vue_lib/utils'
import { numberToVisibility, visibilityToNumber, stateToDisplay } from '../../src/vue_lib/types'
import type { EndpointInfo } from '@martichou/core_lib/bindings/EndpointInfo'
import type { ChannelMessage } from '@martichou/core_lib/bindings/ChannelMessage'

describe('vue_lib types and visibility mapping', () => {
	it('correctly maps visibility enum to numbers and vice versa', () => {
		expect(visibilityToNumber.Visible).toBe(0)
		expect(visibilityToNumber.Invisible).toBe(1)
		expect(visibilityToNumber.Temporarily).toBe(2)

		expect(numberToVisibility[0]).toBe('Visible')
		expect(numberToVisibility[1]).toBe('Invisible')
		expect(numberToVisibility[2]).toBe('Temporarily')
	})

	it('contains required states in stateToDisplay', () => {
		expect(stateToDisplay).toContain('WaitingForUserConsent')
		expect(stateToDisplay).toContain('SendingFiles')
		expect(stateToDisplay).toContain('ReceivingFiles')
		expect(stateToDisplay).toContain('Finished')
		expect(stateToDisplay).toContain('Cancelled')
		expect(stateToDisplay).toContain('Rejected')
	})
})

describe('utils._displayedItems', () => {
	it('transforms endpoints into DisplayedItem array', () => {
		const mockEndpoints: EndpointInfo[] = [
			{
				fullname: 'Pixel 8',
				id: 'ep-1',
				name: 'Pixel 8',
				rtype: 'Phone',
				ip: '192.168.1.50',
				port: '4433',
				present: true,
			},
			{
				fullname: 'Galaxy Tab',
				id: 'ep-2',
				name: 'Galaxy Tab',
				rtype: 'Tablet',
				ip: '192.168.1.51',
				port: '4433',
				present: true,
			},
		]

		const mockVm = {
			endpointsInfo: mockEndpoints,
			requests: [] as ChannelMessage[],
		}

		// @ts-expect-error partial mock for TauriVM
		const items = utils._displayedItems(mockVm)

		expect(items).toHaveLength(2)
		expect(items[0]).toEqual({
			id: 'ep-1',
			name: 'Pixel 8',
			deviceType: 'Phone',
			endpoint: true,
		})
		expect(items[1]).toEqual({
			id: 'ep-2',
			name: 'Galaxy Tab',
			deviceType: 'Tablet',
			endpoint: true,
		})
	})

	it('merges active transfer requests into displayed items', () => {
		const mockEndpoints: EndpointInfo[] = [
			{
				fullname: 'Old Endpoint',
				id: 'x-transfer-1',
				name: 'Old Endpoint',
				rtype: 'Phone',
				ip: '192.168.1.55',
				port: '4433',
				present: true,
			},
		]

		const mockRequests: ChannelMessage[] = [
			{
				id: 'x-transfer-1',
				direction: 'LibToFront',
				state: 'SendingFiles',
				action: null,
				rtype: 'Outbound',
				meta: {
					id: 'meta-1',
					source: { name: 'MacBook Pro', device_type: 'Laptop' },
					total_bytes: 1048576n,
					ack_bytes: 524288n,
					files: ['presentation.pdf'],
					pin_code: '4829',
					destination: null,
					text_description: null,
					text_payload: null,
					text_type: null,
				},
			},
		]

		const mockVm = {
			endpointsInfo: mockEndpoints,
			requests: mockRequests,
		}

		// @ts-expect-error partial mock for TauriVM
		const items = utils._displayedItems(mockVm)

		expect(items).toHaveLength(1)
		expect(items[0].id).toBe('x-transfer-1')
		expect(items[0].name).toBe('MacBook Pro')
		expect(items[0].deviceType).toBe('Laptop')
		expect(items[0].endpoint).toBe(false)
		expect(items[0].state).toBe('SendingFiles')
		expect(items[0].pin_code).toBe('4829')
		expect(items[0].total_bytes).toBe(1048576)
		expect(items[0].ack_bytes).toBe(524288)
	})

	it('filters out messages with non-display states', () => {
		const mockRequests: ChannelMessage[] = [
			{
				id: 'init-msg',
				direction: 'LibToFront',
				state: 'Initial',
				action: null,
				rtype: null,
				meta: null,
			},
		]

		const mockVm = {
			endpointsInfo: [],
			requests: mockRequests,
		}

		// @ts-expect-error partial mock for TauriVM
		const items = utils._displayedItems(mockVm)

		expect(items).toHaveLength(0)
	})
})

describe('utils.getProgress', () => {
	it('calculates CSS progress variable string correctly', () => {
		const item = {
			id: 'item-1',
			name: 'Test',
			deviceType: 'Phone' as const,
			endpoint: false,
			ack_bytes: 250,
			total_bytes: 1000,
		}

		expect(utils.getProgress(item)).toBe('--progress: 25')
	})
})
