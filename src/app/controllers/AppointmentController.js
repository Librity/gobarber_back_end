import { isBefore, subHours } from 'date-fns';

import Appointment from '../models/Appointment';
import User from '../models/User';
import File from '../models/File';

import CreateAppointmentService from '../services/CreateAppointmentService';

import CancellationMail from '../jobs/CancellationMail';
import Queue from '../../lib/Queue';

class AppointmentController {
  async index(req, res) {
    const { page = 1 } = req.query;
    const { requestsPerPage = 20 } = req.query;

    const appointments = await Appointment.findAll({
      where: {
        user_id: req.userId,
        cancelled_at: null,
      },
      order: ['date'],
      limit: requestsPerPage,
      offset: (page - 1) * requestsPerPage,
      attributes: ['id', 'date', 'past', 'cancelable'],
      include: [
        {
          model: User,
          as: 'provider',
          attributes: ['id', 'name'],
          include: [
            {
              model: File,
              as: 'avatar',
              attributes: ['id', 'path', 'url'],
            },
          ],
        },
      ],
    });

    return res.json(appointments);
  }

  async store(req, res) {
    const { provider_id, date } = req.body;

    const appointment = await CreateAppointmentService.run({
      provider_id,
      user_id: req.userId,
      date,
    });

    return res.json(appointment);
  }

  async delete(req, res) {
    const appointment = await Appointment.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'provider',
          attributes: ['name', 'email'],
        },
        {
          model: User,
          as: 'user',
          attributes: ['name', 'email'],
        },
      ],
    });

    if (appointment.user_id !== req.userId) {
      return res.status(401).json({
        error: 'You do not have permission to cancel this appointment.',
      });
    }

    const twoHoursBeforeAppointment = subHours(appointment.date, 2);
    const rightNow = new Date();

    if (isBefore(twoHoursBeforeAppointment, rightNow)) {
      return res.status(401).json({
        error: 'You can only cancel appointments two hours in advance.',
      });
    }

    appointment.cancelled_at = rightNow;
    await appointment.save();

    await Queue.add(CancellationMail.key, {
      appointment,
    });

    return res.json(appointment);
  }
}

export default new AppointmentController();
